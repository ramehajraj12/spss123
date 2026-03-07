// src/providers/event/event.bus.ts
/**
 * Domain event bus for event-driven architecture
 * Allows loose coupling between domains while maintaining consistency
 */
import { Injectable } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';

export interface DomainEvent {
  type: string;
  aggregateId: string;
  aggregateType: string;
  timestamp: Date;
  data: Record<string, any>;
}

@Injectable()
export class EventBus {
  constructor(private eventEmitter: EventEmitter2) {}

  /**
   * Emit a domain event
   */
  async emit(event: DomainEvent): Promise<void> {
    this.eventEmitter.emit(event.type, event);
  }

  /**
   * Subscribe to domain events
   */
  on(eventType: string, handler: (event: DomainEvent) => Promise<void>) {
    this.eventEmitter.on(eventType, handler);
  }

  /**
   * One-time subscription
   */
  once(eventType: string, handler: (event: DomainEvent) => Promise<void>) {
    this.eventEmitter.once(eventType, handler);
  }
}

// src/providers/event/event.handlers.ts
/**
 * Event handlers that respond to domain events
 * These trigger side effects and orchestrate across domains
 */
import { Injectable } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { NotificationsService } from '../../modules/notifications/notifications.service';
import { AuditService } from '../../modules/audit/audit.service';
import { AnalyticsService } from '../../modules/analytics/analytics.service';
import { QueueService } from './queue.service';

@Injectable()
export class DomainEventHandlers {
  constructor(
    private notificationsService: NotificationsService,
    private auditService: AuditService,
    private analyticsService: AnalyticsService,
    private queueService: QueueService,
  ) {}

  /**
   * When a proposal is sent, trigger notifications and tracking
   */
  @OnEvent('proposal.sent')
  async onProposalSent(event: any) {
    const { proposalId, clientId, orgId, clientEmail } = event;

    // Send email notification
    await this.queueService.addJob('email', {
      type: 'proposal_sent',
      to: clientEmail,
      proposalId,
      orgId,
    });

    // Create in-app notification
    await this.notificationsService.createNotification(
      clientId,
      orgId,
      'Proposal Sent',
      'Your proposal has been sent',
      {
        type: 'proposal_sent',
        proposalId,
      },
    );

    // Log audit event
    await this.auditService.log({
      organizationId: orgId,
      eventType: 'PROPOSAL_SENT',
      entityType: 'Proposal',
      entityId: proposalId,
      description: `Proposal sent to client ${clientId}`,
    });

    // Track for analytics
    await this.analyticsService.trackEvent('proposal_sent', {
      proposalId,
      clientId,
      orgId,
    });
  }

  /**
   * When an invoice is issued, generate payment link and schedule reminders
   */
  @OnEvent('invoice.issued')
  async onInvoiceIssued(event: any) {
    const { invoiceId, clientId, dueDate, orgId, clientEmail } = event;

    // Send invoice email with payment link
    await this.queueService.addJob('email', {
      type: 'invoice_issued',
      to: clientEmail,
      invoiceId,
      orgId,
    });

    // Schedule overdue reminder (1 day after due date)
    const reminderDate = new Date(dueDate);
    reminderDate.setDate(reminderDate.getDate() + 1);

    await this.queueService.addDelayedJob(
      'reminders',
      {
        type: 'invoice_overdue',
        invoiceId,
        orgId,
      },
      reminderDate,
    );

    // Track for analytics
    await this.analyticsService.trackEvent('invoice_issued', {
      invoiceId,
      clientId,
      orgId,
      amount: event.amount,
    });
  }

  /**
   * When a payment succeeds, update invoice and send confirmation
   */
  @OnEvent('payment.succeeded')
  async onPaymentSucceeded(event: any) {
    const { paymentId, invoiceId, clientId, amount, orgId } = event;

    // Send payment confirmation email
    await this.queueService.addJob('email', {
      type: 'payment_received',
      invoiceId,
      amount,
      orgId,
    });

    // Create in-app notification
    await this.notificationsService.createNotification(
      clientId,
      orgId,
      'Payment Received',
      `Thank you! We've received your payment of $${amount}`,
      {
        type: 'payment_received',
        paymentId,
        invoiceId,
      },
    );

    // Log audit event
    await this.auditService.log({
      organizationId: orgId,
      eventType: 'PAYMENT_SUCCEEDED',
      entityType: 'Payment',
      entityId: paymentId,
      description: `Payment of $${amount} received for invoice ${invoiceId}`,
    });

    // Track for analytics
    await this.analyticsService.trackEvent('payment_received', {
      paymentId,
      invoiceId,
      amount,
      orgId,
    });
  }

  /**
   * When a contract is fully signed, trigger next steps
   */
  @OnEvent('contract.fully_signed')
  async onContractFullySigned(event: any) {
    const { contractId, clientId, orgId, projectId } = event;

    // Log audit event
    await this.auditService.log({
      organizationId: orgId,
      eventType: 'CONTRACT_FULLY_SIGNED',
      entityType: 'Contract',
      entityId: contractId,
      description: `Contract fully signed by all parties`,
    });

    // Send celebration email to team
    await this.queueService.addJob('email', {
      type: 'contract_signed_celebration',
      contractId,
      orgId,
    });

    // Create project if not already created
    if (projectId) {
      await this.queueService.addJob('projects', {
        type: 'create_from_contract',
        contractId,
        clientId,
        orgId,
      });
    }

    // Track for analytics
    await this.analyticsService.trackEvent('contract_signed', {
      contractId,
      clientId,
      orgId,
    });
  }

  /**
   * When a meeting is scheduled, send invitations and reminders
   */
  @OnEvent('meeting.scheduled')
  async onMeetingScheduled(event: any) {
    const { meetingId, consultantId, clientId, startTime, orgId } = event;

    // Send meeting invitation emails
    await this.queueService.addJob('email', {
      type: 'meeting_invitation',
      meetingId,
      orgId,
    });

    // Schedule reminder (1 day before)
    const reminderDate = new Date(startTime);
    reminderDate.setDate(reminderDate.getDate() - 1);

    await this.queueService.addDelayedJob(
      'reminders',
      {
        type: 'meeting_reminder',
        meetingId,
        orgId,
      },
      reminderDate,
    );

    // Track for analytics
    await this.analyticsService.trackEvent('meeting_scheduled', {
      meetingId,
      consultantId,
      clientId,
      orgId,
    });
  }

  /**
   * When a lead is qualified, log it and create opportunity
   */
  @OnEvent('lead.qualified')
  async onLeadQualified(event: any) {
    const { leadId, orgId, userId } = event;

    await this.auditService.log({
      organizationId: orgId,
      eventType: 'LEAD_QUALIFIED',
      entityType: 'Lead',
      entityId: leadId,
      userId,
      description: 'Lead qualified',
    });

    await this.analyticsService.trackEvent('lead_qualified', {
      leadId,
      orgId,
    });
  }
}

// src/providers/queue/queue.service.ts
/**
 * Job queue service using BullMQ
 * Handles async processing and background jobs
 */
import { Injectable } from '@nestjs/common';
import { Queue, QueueEvents } from 'bullmq';
import { InjectQueue } from '@nestjs/bull';
import { Logger } from '@nestjs/common';

@Injectable()
export class QueueService {
  private logger = new Logger(QueueService.name);

  constructor(
    @InjectQueue('emails') private emailQueue: Queue,
    @InjectQueue('reminders') private reminderQueue: Queue,
    @InjectQueue('notifications') private notificationQueue: Queue,
    @InjectQueue('invoices') private invoiceQueue: Queue,
    @InjectQueue('payments') private paymentQueue: Queue,
    @InjectQueue('webhooks') private webhookQueue: Queue,
    @InjectQueue('analytics') private analyticsQueue: Queue,
  ) {}

  /**
   * Add job to queue
   */
  async addJob(queueName: string, data: Record<string, any>) {
    try {
      const queue = this.getQueue(queueName);
      const job = await queue.add(data, {
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 2000,
        },
        removeOnComplete: true,
        removeOnFail: false,
      });

      this.logger.debug(`Job ${job.id} added to ${queueName} queue`);
      return job;
    } catch (error) {
      this.logger.error(`Failed to add job to ${queueName}: ${error.message}`);
      throw error;
    }
  }

  /**
   * Add delayed job (scheduled for future execution)
   */
  async addDelayedJob(
    queueName: string,
    data: Record<string, any>,
    executeAt: Date,
  ) {
    const queue = this.getQueue(queueName);
    const delayMs = executeAt.getTime() - Date.now();

    const job = await queue.add(data, {
      delay: Math.max(0, delayMs),
      attempts: 3,
      backoff: {
        type: 'exponential',
        delay: 2000,
      },
      removeOnComplete: true,
    });

    return job;
  }

  /**
   * Get job by ID
   */
  async getJob(queueName: string, jobId: string) {
    const queue = this.getQueue(queueName);
    return queue.getJob(jobId);
  }

  /**
   * Get queue statistics
   */
  async getQueueStats(queueName: string) {
    const queue = this.getQueue(queueName);

    const [waitingCount, activeCount, completedCount, failedCount] =
      await Promise.all([
        queue.getWaitingCount(),
        queue.getActiveCount(),
        queue.getCompletedCount(),
        queue.getFailedCount(),
      ]);

    return {
      queue: queueName,
      waiting: waitingCount,
      active: activeCount,
      completed: completedCount,
      failed: failedCount,
    };
  }

  /**
   * Private helper
   */
  private getQueue(name: string): Queue {
    switch (name) {
      case 'email':
      case 'emails':
        return this.emailQueue;
      case 'reminder':
      case 'reminders':
        return this.reminderQueue;
      case 'notification':
      case 'notifications':
        return this.notificationQueue;
      case 'invoice':
      case 'invoices':
        return this.invoiceQueue;
      case 'payment':
      case 'payments':
        return this.paymentQueue;
      case 'webhook':
      case 'webhooks':
        return this.webhookQueue;
      case 'analytic':
      case 'analytics':
        return this.analyticsQueue;
      default:
        throw new Error(`Unknown queue: ${name}`);
    }
  }
}

// src/providers/queue/processors/email.processor.ts
/**
 * Email job processor
 * Handles sending emails asynchronously
 */
import { Process, Processor } from '@nestjs/bull';
import { Job } from 'bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { EmailService } from '../../email/email.service';
import { PrismaService } from '../database/database.service';

@Processor('emails')
@Injectable()
export class EmailProcessor {
  private logger = new Logger(EmailProcessor.name);

  constructor(
    private emailService: EmailService,
    private prisma: PrismaService,
  ) {}

  @Process()
  async handleEmailJob(job: Job<any>) {
    const { type, to, orgId, ...data } = job.data;

    try {
      this.logger.debug(`Processing email job ${job.id}: ${type}`);

      const emailLog = await this.prisma.emailLog.create({
        data: {
          to_email: to,
          organization_id: orgId,
          subject: `Email: ${type}`,
          template: type,
          status: 'PENDING',
        },
      });

      // Send email based on type
      let subject = '';
      let html = '';

      switch (type) {
        case 'proposal_sent':
          subject = 'Your Proposal is Ready';
          html = await this.emailService.renderTemplate('proposal_sent', data);
          break;

        case 'invoice_issued':
          subject = 'Invoice from Your Consultant';
          html = await this.emailService.renderTemplate('invoice_issued', data);
          break;

        case 'payment_received':
          subject = 'Payment Received - Thank You!';
          html = await this.emailService.renderTemplate('payment_received', data);
          break;

        case 'meeting_invitation':
          subject = 'Meeting Invitation';
          html = await this.emailService.renderTemplate('meeting_invitation', data);
          break;

        default:
          throw new Error(`Unknown email type: ${type}`);
      }

      await this.emailService.send({
        to,
        subject,
        html,
      });

      // Mark as sent
      await this.prisma.emailLog.update({
        where: { id: emailLog.id },
        data: {
          status: 'SENT',
          sent_at: new Date(),
        },
      });

      this.logger.debug(`Email job ${job.id} completed`);
    } catch (error) {
      this.logger.error(
        `Email job ${job.id} failed: ${error.message}`,
        error.stack,
      );

      // Update log with failure
      if (job.data.emailLogId) {
        await this.prisma.emailLog.update({
          where: { id: job.data.emailLogId },
          data: {
            status: 'FAILED',
            failed_reason: error.message,
            retry_count: job.attemptsMade,
            next_retry_at:
              job.attemptsMade < 3 ? new Date(Date.now() + 60 * 60 * 1000) : null,
          },
        });
      }

      // Re-throw to let Bull handle retries
      throw error;
    }
  }
}

// src/providers/queue/processors/reminder.processor.ts
/**
 * Reminder job processor
 * Handles scheduled reminders (invoice overdue, meeting reminders, etc.)
 */
import { Process, Processor } from '@nestjs/bull';
import { Job } from 'bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { QueueService } from '../queue.service';
import { PrismaService } from '../database/database.service';

@Processor('reminders')
@Injectable()
export class ReminderProcessor {
  private logger = new Logger(ReminderProcessor.name);

  constructor(
    private queueService: QueueService,
    private prisma: PrismaService,
  ) {}

  @Process()
  async handleReminderJob(job: Job<any>) {
    const { type, invoiceId, meetingId, orgId } = job.data;

    try {
      this.logger.debug(`Processing reminder job ${job.id}: ${type}`);

      switch (type) {
        case 'invoice_overdue':
          await this.handleInvoiceOverdueReminder(invoiceId, orgId);
          break;

        case 'invoice_reminder':
          await this.handleInvoiceReminder(invoiceId, orgId);
          break;

        case 'meeting_reminder':
          await this.handleMeetingReminder(meetingId, orgId);
          break;

        default:
          throw new Error(`Unknown reminder type: ${type}`);
      }

      this.logger.debug(`Reminder job ${job.id} completed`);
    } catch (error) {
      this.logger.error(
        `Reminder job ${job.id} failed: ${error.message}`,
        error.stack,
      );
      throw error;
    }
  }

  private async handleInvoiceOverdueReminder(invoiceId: string, orgId: string) {
    const invoice = await this.prisma.invoice.findUnique({
      where: { id: invoiceId },
      include: { client: { include: { user: true } } },
    });

    if (!invoice) return;

    // Only send if invoice is still unpaid
    if (invoice.status === 'PAID' || invoice.status === 'CANCELLED') return;

    // Send reminder email
    await this.queueService.addJob('email', {
      type: 'invoice_overdue_reminder',
      to: invoice.client.user.email,
      invoiceId,
      orgId,
    });

    // Update invoice to track reminders
    await this.prisma.invoice.update({
      where: { id: invoiceId },
      data: {
        final_reminder_sent: new Date(),
        status: 'OVERDUE',
      },
    });
  }

  private async handleInvoiceReminder(invoiceId: string, orgId: string) {
    const invoice = await this.prisma.invoice.findUnique({
      where: { id: invoiceId },
      include: { client: { include: { user: true } } },
    });

    if (!invoice) return;

    if (invoice.status === 'PAID') return;

    await this.queueService.addJob('email', {
      type: 'invoice_reminder',
      to: invoice.client.user.email,
      invoiceId,
      orgId,
    });
  }

  private async handleMeetingReminder(meetingId: string, orgId: string) {
    const meeting = await this.prisma.meeting.findUnique({
      where: { id: meetingId },
      include: { client: { include: { user: true } }, consultant: { include: { user: true } } },
    });

    if (!meeting) return;

    if (meeting.status === 'CANCELLED') return;

    // Send reminder to both parties
    await this.queueService.addJob('email', {
      type: 'meeting_reminder',
      to: meeting.client.user.email,
      meetingId,
      orgId,
    });

    await this.queueService.addJob('email', {
      type: 'meeting_reminder',
      to: meeting.consultant.user.email,
      meetingId,
      orgId,
    });
  }
}
