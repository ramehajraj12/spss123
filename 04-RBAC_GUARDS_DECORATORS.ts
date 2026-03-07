// src/common/guards/permission.guard.ts
import { Injectable, CanActivate, ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PrismaService } from '../../providers/database/database.service';

export const REQUIRE_PERMISSION_KEY = 'permission';

export function RequirePermission(...permissions: string[]) {
  return (target: any, propertyKey?: string, descriptor?: PropertyDescriptor) => {
    Reflect.metadata(REQUIRE_PERMISSION_KEY, permissions, descriptor?.value || target);
  };
}

const PERMISSION_MAP: Record<string, string[]> = {
  SUPER_ADMIN: [
    'manage_users',
    'manage_organizations',
    'view_audit_logs',
    'system_settings',
    'manage_billing',
  ],
  ORG_ADMIN: [
    'manage_team',
    'manage_organization',
    'manage_proposals',
    'manage_contracts',
    'manage_invoices',
    'manage_projects',
    'view_organization_analytics',
    'view_organization_reports',
    'manage_integrations',
    'invite_members',
    'manage_roles',
  ],
  CONSULTANT: [
    'create_proposal',
    'view_own_proposals',
    'manage_own_projects',
    'create_invoices',
    'view_own_invoices',
    'schedule_meetings',
    'view_client_portal',
    'upload_deliverables',
  ],
  STAFF: [
    'view_organization_data',
    'manage_leads',
    'create_proposals',
    'create_invoices',
    'schedule_meetings',
  ],
  CLIENT: [
    'view_own_projects',
    'view_own_proposals',
    'view_own_invoices',
    'make_payments',
    'download_documents',
    'message_consultant',
  ],
};

@Injectable()
export class PermissionGuard implements CanActivate {
  constructor(
    private reflector: Reflector,
    private prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const requiredPermissions = this.reflector.get<string[]>(
      REQUIRE_PERMISSION_KEY,
      context.getHandler(),
    );

    if (!requiredPermissions || requiredPermissions.length === 0) {
      return true; // No permission required
    }

    const request = context.switchToHttp().getRequest();
    const user = request.user;

    if (!user) {
      throw new ForbiddenException('User not authenticated');
    }

    // Check user's role-based permissions
    const userPermissions = PERMISSION_MAP[user.role] || [];

    const hasPermission = requiredPermissions.some((perm) =>
      userPermissions.includes(perm),
    );

    if (!hasPermission) {
      throw new ForbiddenException(
        `User does not have required permission(s): ${requiredPermissions.join(', ')}`,
      );
    }

    return true;
  }
}

// src/common/guards/role.guard.ts
import { Injectable, CanActivate, ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

export const REQUIRE_ROLE_KEY = 'roles';

export function RequireRole(...roles: string[]) {
  return Reflect.metadata(REQUIRE_ROLE_KEY, roles);
}

@Injectable()
export class RoleGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.get<string[]>(
      REQUIRE_ROLE_KEY,
      context.getHandler(),
    );

    if (!requiredRoles || requiredRoles.length === 0) {
      return true;
    }

    const request = context.switchToHttp().getRequest();
    const user = request.user;

    if (!user || !requiredRoles.includes(user.role)) {
      throw new ForbiddenException('User does not have required role');
    }

    return true;
  }
}

// src/common/guards/ownership.guard.ts
import { Injectable, CanActivate, ExecutionContext, ForbiddenException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../providers/database/database.service';

/**
 * Verifies that a resource belongs to the user's organization
 * and optionally that the user is the owner
 */
@Injectable()
export class OwnershipGuard implements CanActivate {
  constructor(private prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const user = request.user;
    const { id } = request.params;

    if (!user || !id) {
      return true; // Let other guards handle validation
    }

    // Determine resource type from route
    const route = request.route.path;
    const resource = this.getResourceType(route);

    if (!resource) {
      return true; // Route doesn't require ownership check
    }

    // Check if resource belongs to user's organization
    const isOwner = await this.verifyOwnership(resource, id, user.org_id, user.sub);

    if (!isOwner) {
      throw new ForbiddenException('You do not have access to this resource');
    }

    return true;
  }

  private getResourceType(path: string): string | null {
    if (path.includes('/proposals')) return 'proposal';
    if (path.includes('/invoices')) return 'invoice';
    if (path.includes('/contracts')) return 'contract';
    if (path.includes('/projects')) return 'project';
    if (path.includes('/tasks')) return 'task';
    if (path.includes('/leads')) return 'lead';
    return null;
  }

  private async verifyOwnership(
    resource: string,
    resourceId: string,
    orgId: string,
    userId: string,
  ): Promise<boolean> {
    switch (resource) {
      case 'proposal': {
        const proposal = await this.prisma.proposal.findFirst({
          where: { id: resourceId, organization_id: orgId },
        });
        return !!proposal;
      }
      case 'invoice': {
        const invoice = await this.prisma.invoice.findFirst({
          where: { id: resourceId, organization_id: orgId },
        });
        return !!invoice;
      }
      case 'contract': {
        const contract = await this.prisma.contract.findFirst({
          where: { id: contractId, organization_id: orgId },
        });
        return !!contract;
      }
      case 'project': {
        const project = await this.prisma.project.findFirst({
          where: { id: resourceId, organization_id: orgId },
        });
        return !!project;
      }
      case 'task': {
        const task = await this.prisma.task.findFirst({
          where: { id: resourceId, organization_id: orgId },
        });
        return !!task;
      }
      case 'lead': {
        const lead = await this.prisma.lead.findFirst({
          where: { id: resourceId, organization_id: orgId },
        });
        return !!lead;
      }
      default:
        return false;
    }
  }
}

// src/common/decorators/current-user.decorator.ts
import { createParamDecorator, ExecutionContext } from '@nestjs/common';

export interface CurrentUser {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  role: string;
}

export const GetCurrentUser = createParamDecorator(
  (data: keyof CurrentUser | undefined, context: ExecutionContext): CurrentUser | null => {
    const request = context.switchToHttp().getRequest();
    const user = request.user;

    if (!user) {
      return null;
    }

    if (data) {
      return user[data];
    }

    return user;
  },
);

// src/common/decorators/current-org.decorator.ts
import { createParamDecorator, ExecutionContext } from '@nestjs/common';

export const GetCurrentOrg = createParamDecorator(
  (data: string | undefined, context: ExecutionContext): string => {
    const request = context.switchToHttp().getRequest();
    const orgId = request.user?.org_id;

    if (!orgId) {
      throw new Error('Organization context not found');
    }

    return orgId;
  },
);

// src/common/decorators/require-permission.decorator.ts
import { SetMetadata } from '@nestjs/common';

export const PERMISSION_KEY = 'permission';

export const RequirePermission = (...permissions: string[]) =>
  SetMetadata(PERMISSION_KEY, permissions);

// src/common/interceptors/permission-context.interceptor.ts
import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from '@nestjs/common';
import { Observable } from 'rxjs';

/**
 * Injects user and organization context into the request
 * This allows decorators and services to access user context
 */
@Injectable()
export class PermissionContextInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const request = context.switchToHttp().getRequest();
    
    if (request.user) {
      // Ensure org_id is always available
      if (!request.user.org_id) {
        request.org_id = request.user.org_id;
      }
    }

    return next.handle();
  }
}

// Example usage in a controller:
/*

import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { PermissionGuard } from './guards/permission.guard';
import { RoleGuard } from './guards/role.guard';
import { OwnershipGuard } from './guards/ownership.guard';
import { RequirePermission } from './decorators/require-permission.decorator';
import { RequireRole } from './decorators/role.guard';
import { GetCurrentUser, CurrentUser } from './decorators/current-user.decorator';
import { GetCurrentOrg } from './decorators/current-org.decorator';

@Controller('api/v1/proposals')
@UseGuards(JwtAuthGuard) // Require JWT authentication
export class ProposalsController {
  
  @Get(':id')
  @RequirePermission('view_own_proposals')
  @UseGuards(PermissionGuard, OwnershipGuard)
  async getProposal(
    @Param('id') id: string,
    @GetCurrentUser() user: CurrentUser,
    @GetCurrentOrg() orgId: string,
  ) {
    // User is authenticated, has 'view_own_proposals' permission,
    // and the proposal belongs to their organization
  }

  @Post()
  @RequirePermission('create_proposal')
  @UseGuards(PermissionGuard)
  async createProposal(
    @Body() dto: CreateProposalDto,
    @GetCurrentUser() user: CurrentUser,
    @GetCurrentOrg() orgId: string,
  ) {
    // User has create_proposal permission
  }

  @Get()
  @RequireRole('CONSULTANT', 'ORG_ADMIN')
  @UseGuards(RoleGuard)
  async listProposals(
    @GetCurrentUser() user: CurrentUser,
    @GetCurrentOrg() orgId: string,
  ) {
    // Only consultants and org admins can list proposals
  }
}

*/
