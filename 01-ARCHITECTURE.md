# Consulting Management Platform - Backend Architecture

## Table of Contents
1. [Architecture Overview](#architecture-overview)
2. [Design Principles](#design-principles)
3. [Folder Structure](#folder-structure)
4. [Module Breakdown](#module-breakdown)
5. [Key Architectural Patterns](#key-architectural-patterns)
6. [Multi-Tenancy Design](#multi-tenancy-design)
7. [Security Architecture](#security-architecture)

---

## Architecture Overview

### High-Level Design

```
┌─────────────────────────────────────────────────────────┐
│                   API Gateway Layer                      │
│  (Versioning, Rate Limiting, Request Validation)        │
└──────────────────────┬──────────────────────────────────┘
                       │
┌──────────────────────────────────────────────────────────┐
│              NestJS Application Layer                    │
│                                                          │
│  ┌────────────────────────────────────────────────────┐  │
│  │   Auth Module (JWT, Refresh, 2FA, Password Reset) │  │
│  └────────────────────────────────────────────────────┘  │
│                                                          │
│  ┌────────────────────────────────────────────────────┐  │
│  │   Domain Modules (Leads, Proposals, Invoices...)   │  │
│  │   - Controllers (DTOs, Validation)                 │  │
│  │   - Services (Business Logic)                      │  │
│  │   - Repositories (Data Access)                     │  │
│  └────────────────────────────────────────────────────┘  │
│                                                          │
│  ┌────────────────────────────────────────────────────┐  │
│  │   Cross-Cutting Concerns                           │  │
│  │   - Guards (RBAC, Permissions)                     │  │
│  │   - Interceptors (Logging, Transformation)         │  │
│  │   - Filters (Exception Handling)                   │  │
│  │   - Pipes (Validation, Transform)                  │  │
│  └────────────────────────────────────────────────────┘  │
│                                                          │
│  ┌────────────────────────────────────────────────────┐  │
│  │   Infrastructure Services                          │  │
│  │   - Queue Service (Bull/BullMQ)                    │  │
│  │   - Cache Service (Redis)                          │  │
│  │   - Storage Service (S3)                           │  │
│  │   - Email Service (Nodemailer abstraction)         │  │
│  │   - Payment Service (Stripe abstraction)           │  │
│  └────────────────────────────────────────────────────┘  │
└──────────────────────┬───────────────────────────────────┘
                       │
        ┌──────────────┼──────────────┐
        │              │              │
    ┌───┴───┐    ┌────┴────┐    ┌───┴─────┐
    │PostgreSQL│  │  Redis  │    │ S3 / etc│
    └─────────┘  └─────────┘    └─────────┘

External Services: Stripe, Email Provider, Zoom, etc.
```

### Key Characteristics

- **Modular**: Domain-driven design with clear boundaries
- **Multi-tenant**: Organization-scoped data access throughout
- **Async-first**: Event-driven patterns for side effects
- **Secure**: JWT + RBAC, input validation, audit logging
- **Observable**: Structured logging, request tracing
- **Testable**: Dependency injection, clear separation of concerns
- **Scalable**: Stateless services, external state management

---

## Design Principles

### 1. **Modularity**
- Each feature domain is a standalone module with clear boundaries
- Modules communicate through services and events, not direct coupling
- Domain models are encapsulated; external systems use DTOs

### 2. **Separation of Concerns**
- **Controllers**: HTTP contract, routing, request/response mapping
- **Services**: Business logic, orchestration, validation
- **Repositories**: Data persistence and retrieval
- **Guards/Middleware**: Authentication, authorization, cross-cutting concerns

### 3. **Dependency Injection**
- All external dependencies injected via constructor
- Makes testing and swapping implementations trivial
- NestJS module system enforces proper scoping

### 4. **Event-Driven Architecture**
- Major state changes emit domain events
- Side effects (emails, notifications, webhooks) triggered by events
- Loose coupling between domains
- Example: Invoice paid → triggers notification, webhook, analytics update

### 5. **Multi-Tenancy from the Ground Up**
- Every query/mutation respects org_id
- Enforced at repository layer for data consistency
- Tenant context extracted from JWT token
- No cross-tenant data leakage possible

### 6. **API Versioning**
- `/api/v1/`, `/api/v2/`, etc.
- Allows safe evolution without breaking clients
- Deprecation paths clearly documented

### 7. **DTOs for Boundaries**
- Controllers receive/return DTOs, never domain entities directly
- Prevents leakage of internal structure
- Type-safe contract with frontend

---

## Folder Structure

```
consulting-platform-backend/
│
├── src/
│   ├── main.ts                          # Application entry point
│   ├── app.module.ts                    # Root module
│   │
│   ├── config/                          # Configuration management
│   │   ├── configuration.ts             # Centralized config
│   │   ├── database.config.ts
│   │   ├── jwt.config.ts
│   │   ├── storage.config.ts
│   │   └── validation.schema.ts         # Env validation
│   │
│   ├── common/                          # Shared across modules
│   │   ├── constants/
│   │   │   ├── enums.ts                 # Global enums
│   │   │   └── errors.ts                # Error codes
│   │   ├── decorators/
│   │   │   ├── current-user.decorator.ts
│   │   │   ├── current-org.decorator.ts
│   │   │   ├── require-permission.decorator.ts
│   │   │   └── throttle.decorator.ts
│   │   ├── guards/
│   │   │   ├── jwt-auth.guard.ts
│   │   │   ├── refresh-token.guard.ts
│   │   │   ├── permission.guard.ts
│   │   │   ├── role.guard.ts
│   │   │   └── ownership.guard.ts
│   │   ├── filters/
│   │   │   └── global-exception.filter.ts
│   │   ├── interceptors/
│   │   │   ├── logging.interceptor.ts
│   │   │   ├── transform.interceptor.ts
│   │   │   └── performance.interceptor.ts
│   │   ├── pipes/
│   │   │   ├── validation.pipe.ts
│   │   │   └── parse-uuid.pipe.ts
│   │   ├── middleware/
│   │   │   ├── request-context.middleware.ts
│   │   │   └── tenant-context.middleware.ts
│   │   ├── dto/
│   │   │   ├── pagination.dto.ts
│   │   │   ├── response.dto.ts
│   │   │   └── error.dto.ts
│   │   ├── entities/
│   │   │   └── base.entity.ts           # Shared entity traits
│   │   ├── interfaces/
│   │   │   ├── pagination.interface.ts
│   │   │   ├── user-context.interface.ts
│   │   │   └── repository.interface.ts
│   │   └── utils/
│   │       ├── logger.ts
│   │       ├── uuid.ts
│   │       ├── slug.ts
│   │       └── formatting.ts
│   │
│   ├── modules/
│   │   ├── auth/
│   │   │   ├── auth.module.ts
│   │   │   ├── auth.controller.ts
│   │   │   ├── auth.service.ts
│   │   │   ├── jwt.strategy.ts
│   │   │   ├── refresh-token.strategy.ts
│   │   │   ├── dto/
│   │   │   │   ├── login.dto.ts
│   │   │   │   ├── register.dto.ts
│   │   │   │   ├── auth-response.dto.ts
│   │   │   │   ├── password-reset.dto.ts
│   │   │   │   └── 2fa.dto.ts
│   │   │   ├── services/
│   │   │   │   ├── auth.service.ts
│   │   │   │   ├── jwt.service.ts
│   │   │   │   ├── password.service.ts
│   │   │   │   └── 2fa.service.ts
│   │   │   └── test/
│   │   │       └── auth.service.spec.ts
│   │   │
│   │   ├── users/
│   │   │   ├── users.module.ts
│   │   │   ├── users.controller.ts
│   │   │   ├── users.service.ts
│   │   │   ├── users.repository.ts
│   │   │   ├── dto/
│   │   │   │   ├── create-user.dto.ts
│   │   │   │   ├── update-user.dto.ts
│   │   │   │   ├── user.dto.ts
│   │   │   │   └── user-profile.dto.ts
│   │   │   ├── entities/
│   │   │   │   └── user.entity.ts
│   │   │   └── test/
│   │   │       ├── users.service.spec.ts
│   │   │       └── users.controller.spec.ts
│   │   │
│   │   ├── organizations/
│   │   │   ├── organizations.module.ts
│   │   │   ├── organizations.controller.ts
│   │   │   ├── organizations.service.ts
│   │   │   ├── organizations.repository.ts
│   │   │   ├── members.service.ts
│   │   │   ├── dto/
│   │   │   │   ├── create-organization.dto.ts
│   │   │   │   ├── organization.dto.ts
│   │   │   │   ├── invite-member.dto.ts
│   │   │   │   └── organization-settings.dto.ts
│   │   │   ├── entities/
│   │   │   │   ├── organization.entity.ts
│   │   │   │   └── organization-member.entity.ts
│   │   │   └── test/
│   │   │
│   │   ├── leads/
│   │   │   ├── leads.module.ts
│   │   │   ├── leads.controller.ts
│   │   │   ├── leads.service.ts
│   │   │   ├── leads.repository.ts
│   │   │   ├── dto/
│   │   │   │   ├── create-lead.dto.ts
│   │   │   │   ├── update-lead.dto.ts
│   │   │   │   ├── lead.dto.ts
│   │   │   │   ├── lead-status-transition.dto.ts
│   │   │   │   └── bulk-lead.dto.ts
│   │   │   ├── entities/
│   │   │   │   ├── lead.entity.ts
│   │   │   │   └── lead-tag.entity.ts
│   │   │   ├── events/
│   │   │   │   ├── lead-created.event.ts
│   │   │   │   ├── lead-qualified.event.ts
│   │   │   │   └── lead-converted.event.ts
│   │   │   └── test/
│   │   │
│   │   ├── proposals/
│   │   │   ├── proposals.module.ts
│   │   │   ├── proposals.controller.ts
│   │   │   ├── proposals.service.ts
│   │   │   ├── proposals.repository.ts
│   │   │   ├── proposal-items.service.ts
│   │   │   ├── dto/
│   │   │   │   ├── create-proposal.dto.ts
│   │   │   │   ├── update-proposal.dto.ts
│   │   │   │   ├── proposal.dto.ts
│   │   │   │   ├── proposal-item.dto.ts
│   │   │   │   └── proposal-approval.dto.ts
│   │   │   ├── entities/
│   │   │   │   ├── proposal.entity.ts
│   │   │   │   ├── proposal-item.entity.ts
│   │   │   │   └── proposal-version.entity.ts
│   │   │   ├── events/
│   │   │   │   ├── proposal-created.event.ts
│   │   │   │   ├── proposal-sent.event.ts
│   │   │   │   └── proposal-approved.event.ts
│   │   │   └── test/
│   │   │
│   │   ├── contracts/
│   │   │   ├── contracts.module.ts
│   │   │   ├── contracts.controller.ts
│   │   │   ├── contracts.service.ts
│   │   │   ├── contracts.repository.ts
│   │   │   ├── signature.service.ts
│   │   │   ├── dto/
│   │   │   │   ├── create-contract.dto.ts
│   │   │   │   ├── contract.dto.ts
│   │   │   │   ├── request-signature.dto.ts
│   │   │   │   └── sign-contract.dto.ts
│   │   │   ├── entities/
│   │   │   │   ├── contract.entity.ts
│   │   │   │   └── signature-record.entity.ts
│   │   │   ├── events/
│   │   │   │   ├── contract-created.event.ts
│   │   │   │   ├── contract-signed.event.ts
│   │   │   │   └── contract-fully-signed.event.ts
│   │   │   └── test/
│   │   │
│   │   ├── invoices/
│   │   │   ├── invoices.module.ts
│   │   │   ├── invoices.controller.ts
│   │   │   ├── invoices.service.ts
│   │   │   ├── invoices.repository.ts
│   │   │   ├── invoice-items.service.ts
│   │   │   ├── dto/
│   │   │   │   ├── create-invoice.dto.ts
│   │   │   │   ├── invoice.dto.ts
│   │   │   │   ├── invoice-item.dto.ts
│   │   │   │   └── issue-invoice.dto.ts
│   │   │   ├── entities/
│   │   │   │   ├── invoice.entity.ts
│   │   │   │   └── invoice-item.entity.ts
│   │   │   ├── events/
│   │   │   │   ├── invoice-created.event.ts
│   │   │   │   ├── invoice-issued.event.ts
│   │   │   │   └── invoice-paid.event.ts
│   │   │   ├── jobs/
│   │   │   │   ├── invoice-overdue.job.ts
│   │   │   │   ├── invoice-reminder.job.ts
│   │   │   │   └── invoice-generation.job.ts
│   │   │   └── test/
│   │   │
│   │   ├── payments/
│   │   │   ├── payments.module.ts
│   │   │   ├── payments.controller.ts
│   │   │   ├── payments.service.ts
│   │   │   ├── payments.repository.ts
│   │   │   ├── stripe.service.ts
│   │   │   ├── webhook.service.ts
│   │   │   ├── dto/
│   │   │   │   ├── create-payment-intent.dto.ts
│   │   │   │   ├── confirm-payment.dto.ts
│   │   │   │   ├── payment.dto.ts
│   │   │   │   └── refund-request.dto.ts
│   │   │   ├── entities/
│   │   │   │   ├── payment.entity.ts
│   │   │   │   └── payment-attempt.entity.ts
│   │   │   ├── events/
│   │   │   │   ├── payment-initiated.event.ts
│   │   │   │   ├── payment-succeeded.event.ts
│   │   │   │   └── payment-failed.event.ts
│   │   │   ├── jobs/
│   │   │   │   ├── payment-retry.job.ts
│   │   │   │   └── payment-reconciliation.job.ts
│   │   │   └── test/
│   │   │
│   │   ├── projects/
│   │   │   ├── projects.module.ts
│   │   │   ├── projects.controller.ts
│   │   │   ├── projects.service.ts
│   │   │   ├── projects.repository.ts
│   │   │   ├── milestones.service.ts
│   │   │   ├── dto/
│   │   │   │   ├── create-project.dto.ts
│   │   │   │   ├── project.dto.ts
│   │   │   │   ├── project-milestone.dto.ts
│   │   │   │   └── update-project-status.dto.ts
│   │   │   ├── entities/
│   │   │   │   ├── project.entity.ts
│   │   │   │   └── project-milestone.entity.ts
│   │   │   └── test/
│   │   │
│   │   ├── tasks/
│   │   │   ├── tasks.module.ts
│   │   │   ├── tasks.controller.ts
│   │   │   ├── tasks.service.ts
│   │   │   ├── tasks.repository.ts
│   │   │   ├── dto/
│   │   │   │   ├── create-task.dto.ts
│   │   │   │   ├── task.dto.ts
│   │   │   │   └── update-task-status.dto.ts
│   │   │   ├── entities/
│   │   │   │   └── task.entity.ts
│   │   │   └── test/
│   │   │
│   │   ├── scheduling/
│   │   │   ├── scheduling.module.ts
│   │   │   ├── meetings.controller.ts
│   │   │   ├── meetings.service.ts
│   │   │   ├── availability.service.ts
│   │   │   ├── availability.repository.ts
│   │   │   ├── dto/
│   │   │   │   ├── create-meeting.dto.ts
│   │   │   │   ├── meeting.dto.ts
│   │   │   │   ├── set-availability.dto.ts
│   │   │   │   └── book-meeting.dto.ts
│   │   │   ├── entities/
│   │   │   │   ├── meeting.entity.ts
│   │   │   │   ├── availability-rule.entity.ts
│   │   │   │   └── meeting-participant.entity.ts
│   │   │   ├── events/
│   │   │   │   ├── meeting-scheduled.event.ts
│   │   │   │   ├── meeting-reminder.event.ts
│   │   │   │   └── meeting-cancelled.event.ts
│   │   │   └── test/
│   │   │
│   │   ├── files/
│   │   │   ├── files.module.ts
│   │   │   ├── files.controller.ts
│   │   │   ├── files.service.ts
│   │   │   ├── files.repository.ts
│   │   │   ├── storage.service.ts
│   │   │   ├── dto/
│   │   │   │   ├── file.dto.ts
│   │   │   │   ├── upload-file.dto.ts
│   │   │   │   └── signed-url.dto.ts
│   │   │   ├── entities/
│   │   │   │   ├── file-asset.entity.ts
│   │   │   │   └── file-access-log.entity.ts
│   │   │   ├── events/
│   │   │   │   ├── file-uploaded.event.ts
│   │   │   │   ├── file-deleted.event.ts
│   │   │   │   └── file-accessed.event.ts
│   │   │   └── test/
│   │   │
│   │   ├── messages/
│   │   │   ├── messages.module.ts
│   │   │   ├── messages.controller.ts
│   │   │   ├── messages.service.ts
│   │   │   ├── messages.repository.ts
│   │   │   ├── dto/
│   │   │   │   ├── create-message.dto.ts
│   │   │   │   ├── message.dto.ts
│   │   │   │   └── conversation.dto.ts
│   │   │   ├── entities/
│   │   │   │   ├── conversation.entity.ts
│   │   │   │   ├── message.entity.ts
│   │   │   │   └── message-attachment.entity.ts
│   │   │   ├── events/
│   │   │   │   └── message-created.event.ts
│   │   │   └── test/
│   │   │
│   │   ├── notifications/
│   │   │   ├── notifications.module.ts
│   │   │   ├── notifications.controller.ts
│   │   │   ├── notifications.service.ts
│   │   │   ├── notifications.repository.ts
│   │   │   ├── email-notification.service.ts
│   │   │   ├── in-app-notification.service.ts
│   │   │   ├── dto/
│   │   │   │   ├── notification.dto.ts
│   │   │   │   └── notification-preference.dto.ts
│   │   │   ├── entities/
│   │   │   │   ├── notification.entity.ts
│   │   │   │   ├── notification-preference.entity.ts
│   │   │   │   └── email-log.entity.ts
│   │   │   ├── events/
│   │   │   │   └── notification-triggered.event.ts
│   │   │   ├── jobs/
│   │   │   │   └── email-send.job.ts
│   │   │   └── test/
│   │   │
│   │   ├── analytics/
│   │   │   ├── analytics.module.ts
│   │   │   ├── analytics.controller.ts
│   │   │   ├── analytics.service.ts
│   │   │   ├── dashboard-analytics.service.ts
│   │   │   ├── revenue-analytics.service.ts
│   │   │   ├── dto/
│   │   │   │   ├── dashboard-stats.dto.ts
│   │   │   │   ├── revenue-metrics.dto.ts
│   │   │   │   ├── pipeline-analytics.dto.ts
│   │   │   │   └── analytics-filter.dto.ts
│   │   │   ├── entities/
│   │   │   │   └── analytics-event.entity.ts
│   │   │   ├── jobs/
│   │   │   │   ├── daily-aggregation.job.ts
│   │   │   │   └── real-time-metrics.job.ts
│   │   │   └── test/
│   │   │
│   │   ├── audit/
│   │   │   ├── audit.module.ts
│   │   │   ├── audit.controller.ts
│   │   │   ├── audit.service.ts
│   │   │   ├── audit.repository.ts
│   │   │   ├── dto/
│   │   │   │   └── audit-log.dto.ts
│   │   │   ├── entities/
│   │   │   │   └── audit-log.entity.ts
│   │   │   └── test/
│   │   │
│   │   ├── admin/
│   │   │   ├── admin.module.ts
│   │   │   ├── admin.controller.ts
│   │   │   ├── admin.service.ts
│   │   │   ├── user-management.service.ts
│   │   │   ├── organization-management.service.ts
│   │   │   ├── dto/
│   │   │   │   ├── admin-user.dto.ts
│   │   │   │   ├── admin-organization.dto.ts
│   │   │   │   └── admin-action.dto.ts
│   │   │   └── test/
│   │   │
│   │   └── settings/
│   │       ├── settings.module.ts
│   │       ├── settings.controller.ts
│   │       ├── settings.service.ts
│   │       ├── settings.repository.ts
│   │       ├── dto/
│   │       │   ├── system-setting.dto.ts
│   │       │   └── organization-setting.dto.ts
│   │       ├── entities/
│   │       │   └── system-setting.entity.ts
│   │       └── test/
│   │
│   ├── providers/
│   │   ├── database/
│   │   │   ├── database.module.ts
│   │   │   ├── database.service.ts
│   │   │   └── migrations/
│   │   │       └── .gitkeep
│   │   ├── cache/
│   │   │   ├── cache.module.ts
│   │   │   └── cache.service.ts
│   │   ├── queue/
│   │   │   ├── queue.module.ts
│   │   │   ├── queue.service.ts
│   │   │   └── processors/
│   │   │       ├── email.processor.ts
│   │   │       ├── notification.processor.ts
│   │   │       ├── invoice.processor.ts
│   │   │       ├── payment.processor.ts
│   │   │       ├── webhook.processor.ts
│   │   │       └── analytics.processor.ts
│   │   ├── storage/
│   │   │   ├── storage.module.ts
│   │   │   ├── storage.service.ts
│   │   │   └── s3.service.ts
│   │   ├── email/
│   │   │   ├── email.module.ts
│   │   │   ├── email.service.ts
│   │   │   ├── templates/
│   │   │   │   ├── welcome.html
│   │   │   │   ├── invoice.html
│   │   │   │   ├── proposal.html
│   │   │   │   ├── payment-success.html
│   │   │   │   ├── password-reset.html
│   │   │   │   └── meeting-reminder.html
│   │   │   └── test/
│   │   ├── payment/
│   │   │   ├── payment.module.ts
│   │   │   ├── payment.service.ts
│   │   │   ├── stripe.service.ts
│   │   │   └── webhook.handler.ts
│   │   ├── event/
│   │   │   ├── event.module.ts
│   │   │   ├── event.emitter.ts
│   │   │   ├── event.bus.ts
│   │   │   └── handlers/
│   │   │       ├── lead.event-handler.ts
│   │   │       ├── proposal.event-handler.ts
│   │   │       ├── contract.event-handler.ts
│   │   │       ├── invoice.event-handler.ts
│   │   │       ├── payment.event-handler.ts
│   │   │       └── meeting.event-handler.ts
│   │   └── webhook/
│   │       ├── webhook.module.ts
│   │       ├── webhook.service.ts
│   │       ├── webhook.dispatcher.ts
│   │       └── webhook-retry.processor.ts
│   │
│   └── database/
│       ├── prisma/
│       │   ├── schema.prisma           # Main Prisma schema
│       │   ├── seed.ts                 # Database seeding
│       │   └── migrations/
│       │       └── .gitkeep
│       └── factories/
│           ├── user.factory.ts
│           ├── organization.factory.ts
│           ├── lead.factory.ts
│           ├── proposal.factory.ts
│           ├── invoice.factory.ts
│           └── project.factory.ts
│
├── test/
│   ├── integration/
│   │   ├── auth.integration.spec.ts
│   │   ├── lead-to-client.integration.spec.ts
│   │   ├── proposal-workflow.integration.spec.ts
│   │   └── payment-flow.integration.spec.ts
│   ├── e2e/
│   │   └── consulting-flow.e2e.spec.ts
│   └── fixtures/
│       └── .gitkeep
│
├── scripts/
│   ├── seed.sh
│   ├── migrate.sh
│   └── deploy.sh
│
├── docker/
│   ├── Dockerfile
│   ├── Dockerfile.prod
│   ├── docker-compose.yml
│   └── docker-compose.prod.yml
│
├── .env.example
├── .env.test
├── nest-cli.json
├── tsconfig.json
├── .eslintrc.js
├── .prettierrc
├── package.json
└── README.md
```

---

## Module Breakdown

### Core Modules (Essential)

#### 1. **Auth Module**
- JWT strategy with short-lived tokens (15 min)
- Refresh token strategy with longer TTL (7 days)
- Password hashing with argon2
- Password reset flow with secure tokens
- Email verification
- 2FA architecture (TOTP ready)
- Session management

#### 2. **Users Module**
- User creation and management
- User profile management
- Preference settings
- Account status transitions
- User deactivation/deletion with audit trail

#### 3. **Organizations Module**
- Multi-tenant support
- Organization creation and management
- Member invitation and role assignment
- Organization settings
- Subscription/plan management
- Billing contact management

#### 4. **Leads Module**
- Lead capture from multiple sources
- Lead status machine (New → Qualified → Proposal → Client → Archived)
- Bulk import/export
- Tag and categorization system
- Lead history and activity tracking
- Conversion analytics

#### 5. **Proposals Module**
- Template-based or manual proposal creation
- Line items with automatic calculation
- Versioning system for revisions
- Approval workflow
- View tracking and engagement metrics
- Status transitions (Draft → Sent → Accepted → Rejected)

#### 6. **Contracts Module**
- Contract generation from templates
- Signature request workflow
- E-signature tracking with audit trail
- Contract versions
- Status machine (Draft → Pending Signature → Partially Signed → Fully Signed → Archived)

#### 7. **Invoices Module**
- Invoice draft creation
- Line items with taxes and discounts
- Invoice number generation with sequence
- Status progression (Draft → Issued → Partially Paid → Paid → Overdue → Cancelled)
- PDF generation and storage
- Payment terms enforcement

#### 8. **Payments Module**
- Stripe integration abstraction
- Payment intent creation
- Webhook processing for payment status updates
- Payment attempt tracking
- Refund processing
- Reconciliation jobs
- Invoice-to-payment linking

#### 9. **Projects Module**
- Project creation from leads/clients
- Milestone tracking
- Status progression (Planning → Active → On Hold → Completed → Archived)
- Project members and roles
- Budget vs actual tracking

#### 10. **Tasks Module**
- Task creation within projects
- Task hierarchy (parent/child)
- Status transitions (Backlog → In Progress → Completed → Cancelled)
- Task assignment and tracking
- Comments and collaboration

#### 11. **Scheduling Module**
- Availability rule definition (recurring patterns)
- Meeting booking with slot selection
- Integration with Zoom/Google Meet
- Meeting reminders
- Cancellation and rescheduling
- Participant management

#### 12. **Files Module**
- Upload to S3-compatible storage
- File ownership and access control
- Signed URL generation for downloads
- File access logging
- Virus scan placeholder
- Metadata storage

#### 13. **Messages Module**
- Conversation threading
- Message attachments
- Unread status tracking
- Read receipts
- Search across messages

#### 14. **Notifications Module**
- Email notifications triggered by events
- In-app notifications
- Notification preferences per user
- Email log for compliance
- Retry logic for failed sends

#### 15. **Analytics Module**
- Dashboard KPI aggregation
- Revenue metrics
- Pipeline analytics
- Proposal conversion rates
- Project completion rates
- Client growth metrics
- Optimized query performance with caching

#### 16. **Audit Module**
- Comprehensive audit logging
- Admin-queryable audit trails
- Sensitive action tracking (logins, role changes, payments, etc.)
- Retention policies

#### 17. **Admin Module**
- Super admin user management
- Organization and user lifecycle management
- Billing management
- System settings administration
- Suspension/reactivation of accounts

#### 18. **Settings Module**
- Organization-level settings
- System-wide configuration
- Feature flags
- Email configuration
- Payment gateway settings

---

## Key Architectural Patterns

### 1. **Repository Pattern**
```typescript
interface IRepository<T> {
  findById(id: string, orgId: string): Promise<T | null>;
  findAll(filter: FilterDto, orgId: string): Promise<[T[], number]>;
  create(data: CreateDto, orgId: string): Promise<T>;
  update(id: string, data: UpdateDto, orgId: string): Promise<T>;
  delete(id: string, orgId: string): Promise<void>;
}
```

Every repository method includes `orgId` to ensure multi-tenancy compliance.

### 2. **Service Layer Orchestration**
Services handle business logic and domain rules:
- Validation of state transitions
- Calculation of derived fields
- Orchestration of repositories
- Event emission
- Integration with external services

### 3. **Event-Driven Side Effects**
Major domain events trigger cascading actions:
```
Lead Created → Notification Email + CRM Sync + Analytics Track
Proposal Sent → Activity Log + Notification + View Tracking Initialized
Invoice Issued → Payment Link Generation + Email + Reminder Job
Payment Received → Invoice Status Update + Webhook Dispatch + Celebration Email
```

### 4. **RBAC with Permissions**
- Roles define permission sets (not hard-coded role names)
- Guards enforce permissions at controller level
- Repository-level filtering ensures data isolation
- Audit logging for all permission checks

### 5. **DTO Transformation Pipeline**
```
Request JSON → Validation Pipe → DTO → Controller → Service
        ↓                                              ↓
    Validation Error Response                   Domain Entity
                                                      ↓
                                                Response DTO → JSON Response
```

### 6. **Job Queue Architecture**
- Background jobs for async operations
- Retry logic with exponential backoff
- Dead-letter queue for failed jobs
- Job monitoring and alerts

### 7. **Caching Strategy**
- Redis for session tokens
- Cache invalidation on mutations
- Cache warming for analytics queries
- TTL-based expiration for freshness

---

## Multi-Tenancy Design

### Tenant Context Propagation
1. JWT token contains `org_id`
2. Middleware extracts tenant context
3. Decorator injects current org into controllers
4. Repository layer enforces org scoping
5. No cross-tenant queries possible

### Data Isolation Guarantees
- Every table has `org_id` foreign key
- Unique constraints span (org_id, field)
- No table-wide queries; always filtered by org_id
- Soft deletes preserve org boundaries
- Audit logs include org_id for compliance

### Tenant Admin Isolation
- Organization admins can manage only their organization
- Super admins have cross-org visibility with audit trail
- Billing is organization-scoped
- Custom features per organization

---

## Security Architecture

### Authentication Flow
```
1. User submits email + password
2. Password hashed with argon2 and compared
3. Short-lived JWT (15 min) + Refresh Token (7 days) returned
4. Refresh token stored in Redis with revocation support
5. Password reset tokens hashed and time-limited
```

### Authorization Flow
```
1. JWT extracted from Authorization header
2. Signature validated, expiration checked
3. User and organization context extracted
4. Permission guard checks required permissions
5. Ownership guard ensures resource belongs to user's org
6. Service layer enforces business rules
7. Repository layer respects org scoping
```

### Input Validation & Sanitization
- Class-validator with custom decorators
- Prisma ORM prevents SQL injection
- File upload MIME type validation
- Size limits enforced
- XSS prevention in message content

### Sensitive Operations Audit Trail
- Login attempts (success/failure)
- Password changes
- Role/permission changes
- Payment processing
- Signature collection
- File downloads
- Admin actions

---

## Database & ORM Strategy

**Why Prisma:**
- Type-safe query builder prevents SQL injection
- Auto-generated migrations
- Excellent TypeScript support
- Built-in soft delete support
- Clear, readable schema definition

**Connection Pooling:**
- PgBouncer for connection pool management
- Configurable pool size
- Connection timeouts

**Indexing Strategy:**
- Indexes on all foreign keys
- Indexes on frequently filtered fields (org_id, status, date ranges)
- Composite indexes for common query patterns
- Partial indexes for soft-deleted records

---

## API Versioning Strategy

```
/api/v1/    - Current stable version
/api/v2/    - Future major revision (breaking changes)
```

Each version is independently maintained. Deprecation timeline: 6 months minimum.

---

## Scalability Considerations

### Horizontal Scaling
- Stateless application servers
- Load-balanced with health checks
- Redis cluster for session state
- Database read replicas for analytics

### Database Optimization
- Connection pooling (PgBouncer)
- Query optimization with EXPLAIN ANALYZE
- Partitioning for large tables (by org_id or date)
- Archive strategy for historical data

### Async Processing
- BullMQ for job queues
- Multiple workers for high-volume jobs
- Job prioritization (critical vs normal)
- Dead-letter queue monitoring

### Caching Strategy
- Cache layer for dashboard analytics (invalidated on mutations)
- User/organization metadata caching
- File metadata caching
- Cache versioning for safe invalidation

---

## Next Steps

1. Prisma schema (comprehensive data model)
2. Core authentication implementation
3. RBAC and permission system
4. Example modules (Leads, Proposals, Invoices)
5. Service layer with business logic
6. Queue and event system
7. Testing strategy and factories
8. Deployment configuration

