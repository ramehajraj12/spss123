// src/modules/leads/dto/create-lead.dto.ts
import { IsEmail, IsString, IsOptional, IsNotEmpty, Length } from 'class-validator';

export class CreateLeadDto {
  @IsString()
  @IsNotEmpty()
  @Length(1, 100)
  firstName: string;

  @IsString()
  @IsNotEmpty()
  @Length(1, 100)
  lastName: string;

  @IsEmail()
  @IsNotEmpty()
  email: string;

  @IsString()
  @IsOptional()
  phone?: string;

  @IsString()
  @IsOptional()
  company?: string;

  @IsString()
  @IsOptional()
  title?: string;

  @IsString()
  @IsOptional()
  source?: string; // website, referral, cold_outreach, etc.

  @IsString()
  @IsOptional()
  message?: string;

  @IsString()
  @IsOptional()
  budgetRange?: string;

  @IsString()
  @IsOptional()
  timeline?: string;

  @IsOptional()
  tags?: string[];
}

// src/modules/leads/dto/lead.dto.ts
export class LeadDto {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  phone?: string;
  company?: string;
  title?: string;
  source?: string;
  status: string;
  statusChangedAt: Date;
  contactedAt?: Date;
  qualifiedAt?: Date;
  convertedAt?: Date;
  tags: string[];
  createdAt: Date;
  updatedAt: Date;
}

// src/modules/leads/leads.repository.ts
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../providers/database/database.service';
import { CreateLeadDto } from './dto/create-lead.dto';

export interface LeadFilter {
  status?: string;
  source?: string;
  search?: string;
  tags?: string[];
  startDate?: Date;
  endDate?: Date;
  skip?: number;
  take?: number;
}

@Injectable()
export class LeadsRepository {
  constructor(private prisma: PrismaService) {}

  /**
   * Create a new lead
   */
  async create(orgId: string, userId: string, data: CreateLeadDto) {
    const lead = await this.prisma.lead.create({
      data: {
        organization_id: orgId,
        created_by_id: userId,
        first_name: data.firstName,
        last_name: data.lastName,
        email: data.email,
        phone: data.phone,
        company: data.company,
        title: data.title,
        source: data.source,
        message: data.message,
        budget_range: data.budgetRange,
        timeline: data.timeline,
        status: 'NEW',
      },
      include: {
        tags: true,
      },
    });

    // Add tags if provided
    if (data.tags && data.tags.length > 0) {
      await this.prisma.leadTag.createMany({
        data: data.tags.map((tag) => ({
          lead_id: lead.id,
          name: tag,
        })),
      });
    }

    return lead;
  }

  /**
   * Find lead by ID and organization
   */
  async findById(id: string, orgId: string) {
    return this.prisma.lead.findFirst({
      where: {
        id,
        organization_id: orgId,
        deleted_at: null,
      },
      include: {
        tags: true,
        created_by: {
          select: {
            id: true,
            email: true,
            first_name: true,
            last_name: true,
          },
        },
      },
    });
  }

  /**
   * Find all leads with filtering and pagination
   */
  async findAll(orgId: string, filter: LeadFilter) {
    const { status, source, search, tags, startDate, endDate, skip = 0, take = 20 } = filter;

    const where: any = {
      organization_id: orgId,
      deleted_at: null,
    };

    // Apply filters
    if (status) {
      where.status = status;
    }

    if (source) {
      where.source = source;
    }

    if (search) {
      where.OR = [
        {
          first_name: {
            contains: search,
            mode: 'insensitive',
          },
        },
        {
          last_name: {
            contains: search,
            mode: 'insensitive',
          },
        },
        {
          email: {
            contains: search,
            mode: 'insensitive',
          },
        },
        {
          company: {
            contains: search,
            mode: 'insensitive',
          },
        },
      ];
    }

    if (startDate && endDate) {
      where.created_at = {
        gte: startDate,
        lte: endDate,
      };
    }

    // For tag filtering, we need a different approach
    let tagFilter = {};
    if (tags && tags.length > 0) {
      // This finds leads that have ALL specified tags
      // For ANY tag, you'd adjust the filter
      tagFilter = {
        tags: {
          some: {
            name: {
              in: tags,
            },
          },
        },
      };
      Object.assign(where, tagFilter);
    }

    const [leads, total] = await Promise.all([
      this.prisma.lead.findMany({
        where,
        include: {
          tags: true,
          created_by: {
            select: {
              id: true,
              email: true,
              first_name: true,
              last_name: true,
            },
          },
        },
        skip,
        take,
        orderBy: {
          created_at: 'desc',
        },
      }),
      this.prisma.lead.count({ where }),
    ]);

    return [leads, total];
  }

  /**
   * Update lead status
   */
  async updateStatus(id: string, orgId: string, newStatus: string) {
    return this.prisma.lead.update({
      where: {
        id,
        organization_id: orgId,
      },
      data: {
        status: newStatus,
        status_changed_at: new Date(),
        // Set timestamp based on status
        ...(newStatus === 'CONTACTED' && !this.prisma.lead.findUnique({
          where: { id },
        }).then(l => l?.contacted_at) && { contacted_at: new Date() }),
        ...(newStatus === 'QUALIFIED' && { qualified_at: new Date() }),
        ...(newStatus === 'WON' && { converted_at: new Date() }),
      },
      include: { tags: true },
    });
  }

  /**
   * Qualify a lead
   */
  async qualifyLead(id: string, orgId: string, userId: string, notes: string) {
    return this.prisma.lead.update({
      where: {
        id,
        organization_id: orgId,
      },
      data: {
        status: 'QUALIFIED',
        status_changed_at: new Date(),
        qualified_at: new Date(),
        qualified_by_id: userId,
        qualification_notes: notes,
      },
      include: { tags: true },
    });
  }

  /**
   * Convert lead to client
   */
  async convertToClient(id: string, orgId: string, clientId: string) {
    return this.prisma.lead.update({
      where: {
        id,
        organization_id: orgId,
      },
      data: {
        status: 'WON',
        status_changed_at: new Date(),
        converted_at: new Date(),
        converted_to_client_id: clientId,
      },
      include: { tags: true },
    });
  }

  /**
   * Add tags to lead
   */
  async addTags(id: string, orgId: string, tags: string[]) {
    // First verify lead exists and belongs to org
    const lead = await this.findById(id, orgId);
    if (!lead) return null;

    // Create tag records, ignoring duplicates
    for (const tag of tags) {
      await this.prisma.leadTag.upsert({
        where: {
          lead_id_name: {
            lead_id: id,
            name: tag,
          },
        },
        create: {
          lead_id: id,
          name: tag,
        },
        update: {
          name: tag,
        },
      });
    }

    return this.findById(id, orgId);
  }

  /**
   * Remove a lead (soft delete)
   */
  async delete(id: string, orgId: string) {
    return this.prisma.lead.update({
      where: {
        id,
        organization_id: orgId,
      },
      data: {
        deleted_at: new Date(),
      },
    });
  }

  /**
   * Get lead statistics by organization
   */
  async getStats(orgId: string) {
    const stats = await this.prisma.lead.groupBy({
      by: ['status'],
      where: {
        organization_id: orgId,
        deleted_at: null,
      },
      _count: true,
    });

    return stats.reduce(
      (acc, item) => {
        acc[item.status] = item._count;
        return acc;
      },
      {} as Record<string, number>,
    );
  }
}

// src/modules/leads/leads.service.ts
import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { LeadsRepository } from './leads.repository';
import { CreateLeadDto } from './dto/create-lead.dto';
import { PrismaService } from '../../providers/database/database.service';
import { EventEmitter2 } from '@nestjs/event-emitter';

@Injectable()
export class LeadsService {
  constructor(
    private leadsRepository: LeadsRepository,
    private prisma: PrismaService,
    private eventEmitter: EventEmitter2,
  ) {}

  /**
   * Create a new lead
   */
  async createLead(orgId: string, userId: string, dto: CreateLeadDto) {
    const lead = await this.leadsRepository.create(orgId, userId, dto);

    // Emit domain event for side effects (email notification, CRM sync, etc.)
    this.eventEmitter.emit('lead.created', {
      leadId: lead.id,
      orgId,
      userId,
      lead,
    });

    return this.mapToDto(lead);
  }

  /**
   * Get a single lead
   */
  async getLead(id: string, orgId: string) {
    const lead = await this.leadsRepository.findById(id, orgId);

    if (!lead) {
      throw new NotFoundException('Lead not found');
    }

    return this.mapToDto(lead);
  }

  /**
   * List all leads with filtering
   */
  async listLeads(
    orgId: string,
    {
      status,
      source,
      search,
      tags,
      page = 1,
      limit = 20,
    }: {
      status?: string;
      source?: string;
      search?: string;
      tags?: string[];
      page?: number;
      limit?: number;
    },
  ) {
    const skip = (page - 1) * limit;

    const [leads, total] = await this.leadsRepository.findAll(orgId, {
      status,
      source,
      search,
      tags,
      skip,
      take: limit,
    });

    return {
      data: leads.map((lead) => this.mapToDto(lead)),
      pagination: {
        total,
        page,
        limit,
        pages: Math.ceil(total / limit),
      },
    };
  }

  /**
   * Update lead status with validation
   */
  async updateLeadStatus(
    id: string,
    orgId: string,
    newStatus: string,
  ) {
    const lead = await this.leadsRepository.findById(id, orgId);

    if (!lead) {
      throw new NotFoundException('Lead not found');
    }

    // Validate status transition
    this.validateStatusTransition(lead.status, newStatus);

    const updated = await this.leadsRepository.updateStatus(id, orgId, newStatus);

    // Emit event based on status change
    if (newStatus === 'QUALIFIED') {
      this.eventEmitter.emit('lead.qualified', {
        leadId: id,
        orgId,
        lead: updated,
      });
    }

    if (newStatus === 'WON') {
      this.eventEmitter.emit('lead.won', {
        leadId: id,
        orgId,
        lead: updated,
      });
    }

    return this.mapToDto(updated);
  }

  /**
   * Qualify a lead
   */
  async qualifyLead(
    id: string,
    orgId: string,
    userId: string,
    notes: string,
  ) {
    const lead = await this.leadsRepository.findById(id, orgId);

    if (!lead) {
      throw new NotFoundException('Lead not found');
    }

    if (lead.status === 'WON' || lead.status === 'LOST') {
      throw new BadRequestException(
        'Cannot qualify a lead that is already won or lost',
      );
    }

    const updated = await this.leadsRepository.qualifyLead(
      id,
      orgId,
      userId,
      notes,
    );

    this.eventEmitter.emit('lead.qualified', {
      leadId: id,
      orgId,
      userId,
      lead: updated,
    });

    return this.mapToDto(updated);
  }

  /**
   * Convert lead to client and create client record
   */
  async convertLeadToClient(
    id: string,
    orgId: string,
  ) {
    const lead = await this.leadsRepository.findById(id, orgId);

    if (!lead) {
      throw new NotFoundException('Lead not found');
    }

    if (lead.status !== 'QUALIFIED' && lead.status !== 'PROPOSAL_SENT') {
      throw new BadRequestException(
        'Lead must be qualified or have proposal sent to convert',
      );
    }

    // Create user for the client
    const clientUser = await this.prisma.user.create({
      data: {
        email: lead.email,
        first_name: lead.first_name,
        last_name: lead.last_name,
        password_hash: '', // Will be set on first login via password reset
        status: 'ACTIVE',
      },
    });

    // Create client record
    const client = await this.prisma.client.create({
      data: {
        organization_id: orgId,
        user_id: clientUser.id,
        company_name: lead.company,
        contact_first_name: lead.first_name,
        contact_last_name: lead.last_name,
        contact_email: lead.email,
        contact_phone: lead.phone,
        contact_title: lead.title,
        source: lead.source,
      },
    });

    // Mark lead as converted
    const converted = await this.leadsRepository.convertToClient(
      id,
      orgId,
      client.id,
    );

    // Emit event for side effects
    this.eventEmitter.emit('lead.converted', {
      leadId: id,
      orgId,
      clientId: client.id,
      lead: converted,
    });

    return this.mapToDto(converted);
  }

  /**
   * Get lead statistics
   */
  async getLeadStats(orgId: string) {
    const stats = await this.leadsRepository.getStats(orgId);

    return {
      total: Object.values(stats).reduce((a, b) => a + b, 0),
      byStatus: stats,
    };
  }

  /**
   * Private helper methods
   */

  private validateStatusTransition(currentStatus: string, newStatus: string) {
    const validTransitions: Record<string, string[]> = {
      NEW: ['CONTACTED', 'ARCHIVED'],
      CONTACTED: ['QUALIFIED', 'LOST', 'ARCHIVED'],
      QUALIFIED: ['PROPOSAL_SENT', 'NEGOTIATING', 'LOST', 'ARCHIVED'],
      PROPOSAL_SENT: ['NEGOTIATING', 'LOST', 'WON', 'ARCHIVED'],
      NEGOTIATING: ['PROPOSAL_SENT', 'LOST', 'WON', 'ARCHIVED'],
      WON: ['ARCHIVED'],
      LOST: ['ARCHIVED'],
      ARCHIVED: [],
    };

    const allowed = validTransitions[currentStatus] || [];

    if (!allowed.includes(newStatus)) {
      throw new BadRequestException(
        `Cannot transition from ${currentStatus} to ${newStatus}`,
      );
    }
  }

  private mapToDto(lead: any) {
    return {
      id: lead.id,
      firstName: lead.first_name,
      lastName: lead.last_name,
      email: lead.email,
      phone: lead.phone,
      company: lead.company,
      title: lead.title,
      source: lead.source,
      status: lead.status,
      statusChangedAt: lead.status_changed_at,
      contactedAt: lead.contacted_at,
      qualifiedAt: lead.qualified_at,
      convertedAt: lead.converted_at,
      tags: lead.tags.map((t: any) => t.name),
      createdAt: lead.created_at,
      updatedAt: lead.updated_at,
    };
  }
}

// src/modules/leads/leads.controller.ts
import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
  UseGuards,
  HttpCode,
} from '@nestjs/common';
import { LeadsService } from './leads.service';
import { CreateLeadDto } from './dto/create-lead.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionGuard } from '../../common/guards/permission.guard';
import { OwnershipGuard } from '../../common/guards/ownership.guard';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { GetCurrentUser, CurrentUser } from '../../common/decorators/current-user.decorator';
import { GetCurrentOrg } from '../../common/decorators/current-org.decorator';

@Controller('api/v1/leads')
@UseGuards(JwtAuthGuard)
export class LeadsController {
  constructor(private leadsService: LeadsService) {}

  @Post()
  @RequirePermission('manage_leads')
  @UseGuards(PermissionGuard)
  @HttpCode(201)
  async createLead(
    @Body() dto: CreateLeadDto,
    @GetCurrentUser() user: CurrentUser,
    @GetCurrentOrg() orgId: string,
  ) {
    return this.leadsService.createLead(orgId, user.id, dto);
  }

  @Get()
  @RequirePermission('manage_leads', 'view_organization_data')
  @UseGuards(PermissionGuard)
  async listLeads(
    @Query('status') status?: string,
    @Query('source') source?: string,
    @Query('search') search?: string,
    @Query('tags') tags?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @GetCurrentOrg() orgId?: string,
  ) {
    const tagArray = tags ? tags.split(',') : undefined;

    return this.leadsService.listLeads(orgId, {
      status,
      source,
      search,
      tags: tagArray,
      page: page ? parseInt(page) : 1,
      limit: limit ? parseInt(limit) : 20,
    });
  }

  @Get('stats')
  async getLeadStats(@GetCurrentOrg() orgId: string) {
    return this.leadsService.getLeadStats(orgId);
  }

  @Get(':id')
  @UseGuards(OwnershipGuard)
  async getLead(
    @Param('id') id: string,
    @GetCurrentOrg() orgId: string,
  ) {
    return this.leadsService.getLead(id, orgId);
  }

  @Post(':id/qualify')
  @RequirePermission('manage_leads')
  @UseGuards(PermissionGuard, OwnershipGuard)
  async qualifyLead(
    @Param('id') id: string,
    @Body() body: { notes: string },
    @GetCurrentUser() user: CurrentUser,
    @GetCurrentOrg() orgId: string,
  ) {
    return this.leadsService.qualifyLead(id, orgId, user.id, body.notes);
  }

  @Post(':id/convert-to-client')
  @RequirePermission('manage_leads')
  @UseGuards(PermissionGuard, OwnershipGuard)
  async convertToClient(
    @Param('id') id: string,
    @GetCurrentOrg() orgId: string,
  ) {
    return this.leadsService.convertLeadToClient(id, orgId);
  }

  @Post(':id/status')
  @RequirePermission('manage_leads')
  @UseGuards(PermissionGuard, OwnershipGuard)
  async updateStatus(
    @Param('id') id: string,
    @Body() body: { status: string },
    @GetCurrentOrg() orgId: string,
  ) {
    return this.leadsService.updateLeadStatus(id, orgId, body.status);
  }
}
