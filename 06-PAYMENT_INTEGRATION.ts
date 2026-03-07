// src/providers/payment/payment.service.ts
/**
 * Abstract payment service interface
 * This allows us to swap payment providers without changing business logic
 */
import { Injectable } from '@nestjs/common';

export interface PaymentIntentRequest {
  amount: number;
  currency: string;
  invoiceId: string;
  customerId?: string;
  metadata?: Record<string, string>;
  description?: string;
}

export interface PaymentIntentResponse {
  id: string;
  clientSecret?: string;
  status: 'requires_action' | 'succeeded' | 'processing';
  amount: number;
  currency: string;
}

export interface PaymentConfirmRequest {
  intentId: string;
  paymentMethodId?: string;
  metadata?: Record<string, string>;
}

export interface PaymentConfirmResponse {
  id: string;
  status: 'succeeded' | 'failed' | 'processing';
  amount: number;
  currency: string;
  error?: string;
}

export interface RefundRequest {
  chargeId: string;
  amount?: number;
  reason?: string;
  metadata?: Record<string, string>;
}

export interface RefundResponse {
  id: string;
  status: 'succeeded' | 'failed' | 'processing';
  amount: number;
}

export abstract class PaymentServiceInterface {
  abstract createPaymentIntent(
    request: PaymentIntentRequest,
  ): Promise<PaymentIntentResponse>;

  abstract confirmPayment(
    request: PaymentConfirmRequest,
  ): Promise<PaymentConfirmResponse>;

  abstract refundPayment(
    request: RefundRequest,
  ): Promise<RefundResponse>;

  abstract getPaymentStatus(paymentId: string): Promise<any>;

  abstract createWebhookSignature(body: Buffer, signature: string): boolean;

  abstract handleWebhook(event: any): Promise<void>;
}

// src/providers/payment/stripe.service.ts
import { Injectable, BadRequestException, InternalServerErrorException } from '@nestjs/common';
import Stripe from 'stripe';
import {
  PaymentServiceInterface,
  PaymentIntentRequest,
  PaymentIntentResponse,
  PaymentConfirmRequest,
  PaymentConfirmResponse,
  RefundRequest,
  RefundResponse,
} from './payment.service';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../database/database.service';
import { EventEmitter2 } from '@nestjs/event-emitter';

@Injectable()
export class StripeService implements PaymentServiceInterface {
  private stripe: Stripe;
  private webhookSecret: string;

  constructor(
    private configService: ConfigService,
    private prisma: PrismaService,
    private eventEmitter: EventEmitter2,
  ) {
    const apiKey = this.configService.get<string>('STRIPE_SECRET_KEY');
    this.webhookSecret = this.configService.get<string>('STRIPE_WEBHOOK_SECRET');

    if (!apiKey) {
      throw new Error('STRIPE_SECRET_KEY is not configured');
    }

    this.stripe = new Stripe(apiKey, {
      apiVersion: '2023-10-16',
    });
  }

  /**
   * Create a payment intent
   * This initiates a payment flow but doesn't charge the card yet
   */
  async createPaymentIntent(
    request: PaymentIntentRequest,
  ): Promise<PaymentIntentResponse> {
    try {
      const intent = await this.stripe.paymentIntents.create({
        amount: Math.round(request.amount * 100), // Convert to cents
        currency: request.currency.toLowerCase(),
        description: request.description || `Invoice ${request.invoiceId}`,
        metadata: {
          invoiceId: request.invoiceId,
          ...request.metadata,
        },
        automatic_payment_methods: {
          enabled: true,
        },
      });

      return {
        id: intent.id,
        clientSecret: intent.client_secret,
        status: intent.status as any,
        amount: intent.amount / 100,
        currency: intent.currency,
      };
    } catch (error) {
      throw new InternalServerErrorException(
        `Failed to create payment intent: ${error.message}`,
      );
    }
  }

  /**
   * Confirm a payment
   * This finalizes the payment after the client provides payment details
   */
  async confirmPayment(
    request: PaymentConfirmRequest,
  ): Promise<PaymentConfirmResponse> {
    try {
      const intent = await this.stripe.paymentIntents.confirm(
        request.intentId,
        {
          payment_method: request.paymentMethodId,
        },
      );

      const success = intent.status === 'succeeded';

      return {
        id: intent.id,
        status: intent.status as any,
        amount: intent.amount / 100,
        currency: intent.currency,
        error: intent.last_payment_error?.message,
      };
    } catch (error) {
      return {
        id: request.intentId,
        status: 'failed',
        amount: 0,
        currency: 'usd',
        error: error.message,
      };
    }
  }

  /**
   * Refund a payment
   */
  async refundPayment(
    request: RefundRequest,
  ): Promise<RefundResponse> {
    try {
      const refund = await this.stripe.refunds.create({
        charge: request.chargeId,
        amount: request.amount ? Math.round(request.amount * 100) : undefined,
        reason: request.reason as any,
        metadata: request.metadata,
      });

      return {
        id: refund.id,
        status: refund.status as any,
        amount: refund.amount / 100,
      };
    } catch (error) {
      throw new InternalServerErrorException(
        `Failed to refund payment: ${error.message}`,
      );
    }
  }

  /**
   * Get payment status
   */
  async getPaymentStatus(paymentId: string): Promise<any> {
    try {
      return await this.stripe.paymentIntents.retrieve(paymentId);
    } catch (error) {
      throw new BadRequestException('Invalid payment ID');
    }
  }

  /**
   * Verify webhook signature (Stripe-specific)
   */
  createWebhookSignature(body: Buffer, signature: string): boolean {
    try {
      const event = this.stripe.webhooks.constructEvent(
        body,
        signature,
        this.webhookSecret,
      );
      return !!event;
    } catch {
      return false;
    }
  }

  /**
   * Handle Stripe webhook events
   */
  async handleWebhook(body: Buffer, signature: string): Promise<void> {
    try {
      const event = this.stripe.webhooks.constructEvent(
        body,
        signature,
        this.webhookSecret,
      ) as Stripe.Event;

      switch (event.type) {
        case 'payment_intent.succeeded':
          await this.handlePaymentSucceeded(event.data.object as Stripe.PaymentIntent);
          break;

        case 'payment_intent.payment_failed':
          await this.handlePaymentFailed(event.data.object as Stripe.PaymentIntent);
          break;

        case 'charge.refunded':
          await this.handleRefunded(event.data.object as Stripe.Charge);
          break;
      }
    } catch (error) {
      throw new BadRequestException('Invalid webhook signature');
    }
  }

  /**
   * Private handlers for webhook events
   */

  private async handlePaymentSucceeded(intent: Stripe.PaymentIntent) {
    const invoiceId = intent.metadata.invoiceId;

    // Update payment in database
    const payment = await this.prisma.payment.findFirst({
      where: {
        stripe_payment_intent_id: intent.id,
      },
      include: { invoice: { include: { client: true } } },
    });

    if (!payment) return;

    // Update payment status
    await this.prisma.payment.update({
      where: { id: payment.id },
      data: {
        status: 'SUCCEEDED',
        stripe_charge_id: intent.charges.data[0]?.id,
        processed_at: new Date(),
      },
    });

    // Update invoice
    const invoice = payment.invoice;
    const amountPaid = invoice.amount_paid + payment.amount;
    const isPaid = amountPaid >= invoice.total_amount;

    await this.prisma.invoice.update({
      where: { id: invoice.id },
      data: {
        amount_paid: amountPaid,
        status: isPaid ? 'PAID' : 'PARTIALLY_PAID',
      },
    });

    // Emit event for side effects (email notification, analytics, etc.)
    this.eventEmitter.emit('payment.succeeded', {
      paymentId: payment.id,
      invoiceId: invoice.id,
      clientId: invoice.client_id,
      amount: payment.amount,
      orgId: invoice.organization_id,
    });
  }

  private async handlePaymentFailed(intent: Stripe.PaymentIntent) {
    const payment = await this.prisma.payment.findFirst({
      where: {
        stripe_payment_intent_id: intent.id,
      },
    });

    if (!payment) return;

    // Record failed attempt
    const error = intent.last_payment_error?.message || 'Unknown error';

    await this.prisma.paymentAttempt.create({
      data: {
        payment_id: payment.id,
        organization_id: payment.organization_id,
        status: 'FAILED',
        error_message: error,
        error_code: intent.last_payment_error?.code,
        retry_count: 0,
        next_retry_at: new Date(Date.now() + 24 * 60 * 60 * 1000), // Retry in 24 hours
      },
    });

    // Update payment status
    await this.prisma.payment.update({
      where: { id: payment.id },
      data: {
        status: 'FAILED',
      },
    });

    // Emit event
    this.eventEmitter.emit('payment.failed', {
      paymentId: payment.id,
      error,
    });
  }

  private async handleRefunded(charge: Stripe.Charge) {
    const payment = await this.prisma.payment.findFirst({
      where: {
        stripe_charge_id: charge.id,
      },
      include: { invoice: true },
    });

    if (!payment) return;

    const refundAmount = charge.amount_refunded / 100;

    await this.prisma.payment.update({
      where: { id: payment.id },
      data: {
        status: 'REFUNDED',
        refund_amount: refundAmount,
        refunded_at: new Date(),
      },
    });

    this.eventEmitter.emit('payment.refunded', {
      paymentId: payment.id,
      invoiceId: payment.invoice_id,
      refundAmount,
    });
  }
}

// src/modules/payments/payments.service.ts
import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { StripeService, PaymentIntentRequest } from '../../providers/payment/stripe.service';
import { PrismaService } from '../../providers/database/database.service';
import { EventEmitter2 } from '@nestjs/event-emitter';

@Injectable()
export class PaymentsService {
  constructor(
    private stripeService: StripeService,
    private prisma: PrismaService,
    private eventEmitter: EventEmitter2,
  ) {}

  /**
   * Create a payment intent for an invoice
   */
  async createPaymentIntent(invoiceId: string, orgId: string) {
    // Fetch invoice
    const invoice = await this.prisma.invoice.findFirst({
      where: {
        id: invoiceId,
        organization_id: orgId,
      },
    });

    if (!invoice) {
      throw new NotFoundException('Invoice not found');
    }

    if (invoice.status === 'PAID') {
      throw new BadRequestException('Invoice is already paid');
    }

    // Calculate amount due
    const amountDue = invoice.total_amount - invoice.amount_paid;

    // Create payment record
    const payment = await this.prisma.payment.create({
      data: {
        organization_id: orgId,
        invoice_id: invoiceId,
        amount: amountDue,
        currency: invoice.currency,
        status: 'PENDING',
      },
    });

    // Create Stripe payment intent
    const intent = await this.stripeService.createPaymentIntent({
      amount: amountDue,
      currency: invoice.currency,
      invoiceId: invoiceId,
      description: `Invoice ${invoice.invoice_number} - ${invoice.client_id}`,
      metadata: {
        invoiceId,
        paymentId: payment.id,
      },
    });

    // Store Stripe intent ID
    await this.prisma.payment.update({
      where: { id: payment.id },
      data: {
        stripe_payment_intent_id: intent.id,
        payment_link: `${process.env.FRONTEND_URL}/pay/${intent.id}`,
      },
    });

    // Emit event
    this.eventEmitter.emit('payment.initiated', {
      paymentId: payment.id,
      invoiceId,
      amount: amountDue,
      orgId,
    });

    return {
      id: payment.id,
      clientSecret: intent.clientSecret,
      amount: amountDue,
      currency: invoice.currency,
    };
  }

  /**
   * Confirm a payment after client submits payment details
   */
  async confirmPayment(
    paymentId: string,
    orgId: string,
    paymentMethodId: string,
  ) {
    const payment = await this.prisma.payment.findFirst({
      where: {
        id: paymentId,
        organization_id: orgId,
      },
    });

    if (!payment) {
      throw new NotFoundException('Payment not found');
    }

    if (payment.status !== 'PENDING') {
      throw new BadRequestException('Payment has already been processed');
    }

    // Confirm with Stripe
    const result = await this.stripeService.confirmPayment({
      intentId: payment.stripe_payment_intent_id,
      paymentMethodId,
    });

    // Record attempt
    await this.prisma.paymentAttempt.create({
      data: {
        payment_id: paymentId,
        organization_id: orgId,
        status: result.status === 'succeeded' ? 'SUCCEEDED' : 'FAILED',
        error_message: result.error,
        retry_count: 0,
      },
    });

    return result;
  }

  /**
   * Get payment details
   */
  async getPayment(paymentId: string, orgId: string) {
    const payment = await this.prisma.payment.findFirst({
      where: {
        id: paymentId,
        organization_id: orgId,
      },
      include: {
        invoice: true,
        attempts: true,
      },
    });

    if (!payment) {
      throw new NotFoundException('Payment not found');
    }

    return payment;
  }

  /**
   * List payments for organization
   */
  async listPayments(
    orgId: string,
    {
      status,
      page = 1,
      limit = 20,
    }: {
      status?: string;
      page?: number;
      limit?: number;
    },
  ) {
    const skip = (page - 1) * limit;

    const where: any = {
      organization_id: orgId,
    };

    if (status) {
      where.status = status;
    }

    const [payments, total] = await Promise.all([
      this.prisma.payment.findMany({
        where,
        include: { invoice: true },
        skip,
        take: limit,
        orderBy: { created_at: 'desc' },
      }),
      this.prisma.payment.count({ where }),
    ]);

    return {
      data: payments,
      pagination: {
        total,
        page,
        limit,
        pages: Math.ceil(total / limit),
      },
    };
  }

  /**
   * Refund a payment
   */
  async refundPayment(
    paymentId: string,
    orgId: string,
    amount?: number,
    reason?: string,
  ) {
    const payment = await this.prisma.payment.findFirst({
      where: {
        id: paymentId,
        organization_id: orgId,
      },
    });

    if (!payment) {
      throw new NotFoundException('Payment not found');
    }

    if (payment.status !== 'SUCCEEDED') {
      throw new BadRequestException('Only succeeded payments can be refunded');
    }

    if (!payment.stripe_charge_id) {
      throw new BadRequestException('Cannot refund payment without charge ID');
    }

    // Process refund with Stripe
    const refund = await this.stripeService.refundPayment({
      chargeId: payment.stripe_charge_id,
      amount: amount || payment.amount,
      reason: reason || 'requested_by_customer',
    });

    return {
      refundId: refund.id,
      amount: refund.amount,
      status: refund.status,
    };
  }
}

// src/modules/payments/payments.controller.ts
import { Controller, Post, Get, Param, Body, UseGuards, HttpCode } from '@nestjs/common';
import { PaymentsService } from './payments.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { GetCurrentOrg } from '../../common/decorators/current-org.decorator';
import { PermissionGuard } from '../../common/guards/permission.guard';

@Controller('api/v1/payments')
@UseGuards(JwtAuthGuard)
export class PaymentsController {
  constructor(private paymentsService: PaymentsService) {}

  @Post('intents')
  @RequirePermission('make_payments')
  @UseGuards(PermissionGuard)
  @HttpCode(201)
  async createPaymentIntent(
    @Body() body: { invoiceId: string },
    @GetCurrentOrg() orgId: string,
  ) {
    return this.paymentsService.createPaymentIntent(body.invoiceId, orgId);
  }

  @Post(':id/confirm')
  @RequirePermission('make_payments')
  @UseGuards(PermissionGuard)
  async confirmPayment(
    @Param('id') paymentId: string,
    @Body() body: { paymentMethodId: string },
    @GetCurrentOrg() orgId: string,
  ) {
    return this.paymentsService.confirmPayment(paymentId, orgId, body.paymentMethodId);
  }

  @Get(':id')
  async getPayment(
    @Param('id') paymentId: string,
    @GetCurrentOrg() orgId: string,
  ) {
    return this.paymentsService.getPayment(paymentId, orgId);
  }

  @Get()
  async listPayments(
    @Body() body: { status?: string; page?: number; limit?: number },
    @GetCurrentOrg() orgId: string,
  ) {
    return this.paymentsService.listPayments(orgId, body);
  }

  @Post(':id/refund')
  @RequirePermission('manage_invoices')
  @UseGuards(PermissionGuard)
  async refundPayment(
    @Param('id') paymentId: string,
    @Body() body: { amount?: number; reason?: string },
    @GetCurrentOrg() orgId: string,
  ) {
    return this.paymentsService.refundPayment(
      paymentId,
      orgId,
      body.amount,
      body.reason,
    );
  }
}
