# Consulting Management Platform - Implementation Guide

## Quick Start

### 1. Project Setup

```bash
# Create new NestJS project
npx @nestjs/cli new consulting-platform
cd consulting-platform

# Install core dependencies
npm install @nestjs/common @nestjs/core @nestjs/jwt @nestjs/passport passport passport-jwt
npm install @nestjs/config @nestjs/swagger
npm install @prisma/client prisma
npm install redis ioredis @nestjs/cache-manager
npm install @nestjs/bull bullmq
npm install @nestjs/event-emitter
npm install class-validator class-transformer
npm install argon2
npm install stripe
npm install nodemailer
npm install aws-sdk
npm install helmet compression

# Dev dependencies
npm install -D @types/express @types/node
npm install -D @nestjs/testing jest ts-jest
npm install -D prettier eslint
npm install -D prisma
```

### 2. Initialize Prisma

```bash
npx prisma init

# Update .env with DATABASE_URL
# Copy the schema.prisma from 02-PRISMA_SCHEMA.prisma
# Run migrations
npx prisma migrate dev --name init

# Generate Prisma client
npx prisma generate
```

### 3. Project Structure

Follow the folder structure from 01-ARCHITECTURE.md exactly. This ensures:
- Clear module boundaries
- Easy navigation
- Scalable organization
- Team onboarding clarity

### 4. Core Modules Implementation Order

Implement modules in this order to minimize dependency issues:

#### Phase 1: Foundation (Week 1)
1. **Config Module** - Centralized configuration
2. **Database Module** - Prisma setup
3. **Auth Module** - JWT, refresh tokens, password reset
4. **Users Module** - User management
5. **Organizations Module** - Multi-tenancy support

#### Phase 2: Core Business (Week 2-3)
6. **Leads Module** - Lead management
7. **Clients Module** - Client management
8. **Consultants Module** - Consultant profiles

#### Phase 3: Commercial Flow (Week 4-5)
9. **Proposals Module** - Proposal generation and tracking
10. **Contracts Module** - Contract management
11. **Invoices Module** - Invoice generation
12. **Payments Module** - Payment processing (Stripe integration)

#### Phase 4: Operations (Week 6)
13. **Projects Module** - Project management
14. **Tasks Module** - Task tracking
15. **Scheduling Module** - Meeting scheduling

#### Phase 5: Support Services (Week 7)
16. **Files Module** - File upload/download
17. **Messages Module** - Internal messaging
18. **Notifications Module** - Email and in-app notifications
19. **Analytics Module** - Metrics and dashboards

#### Phase 6: Governance (Week 8)
20. **Audit Module** - Audit logging
21. **Admin Module** - Admin controls
22. **Settings Module** - System settings

---

## Key Implementation Patterns

### 1. Module Structure

Every module should follow this structure:

```
module-name/
├── module-name.module.ts       # Imports and exports
├── module-name.controller.ts    # HTTP endpoints
├── module-name.service.ts       # Business logic
├── module-name.repository.ts    # Data access
├── dto/
│   ├── create-*.dto.ts
│   ├── update-*.dto.ts
│   └── *.dto.ts
├── entities/
│   └── *.entity.ts
├── events/
│   └── *.event.ts
├── jobs/ (if applicable)
│   └── *.job.ts
└── test/
    ├── *.service.spec.ts
    └── *.controller.spec.ts
```

### 2. RBAC Implementation

Every controller must:
1. Use `@UseGuards(JwtAuthGuard)` for authentication
2. Use `@RequirePermission()` or `@RequireRole()` for authorization
3. Use `@GetCurrentUser()` and `@GetCurrentOrg()` decorators for context
4. Use `OwnershipGuard` for resource-specific access

Example:
```typescript
@Post()
@RequirePermission('create_proposal')
@UseGuards(PermissionGuard)
async create(
  @Body() dto: CreateProposalDto,
  @GetCurrentUser() user: CurrentUser,
  @GetCurrentOrg() orgId: string,
) {
  return this.service.create(orgId, user.id, dto);
}
```

### 3. Service Layer Pattern

Services should:
1. Accept `orgId` as first parameter to enforce multi-tenancy
2. Use repositories for data access
3. Emit domain events for side effects
4. Validate business rules
5. Handle status transitions properly

Example:
```typescript
async updateStatus(id: string, orgId: string, newStatus: string) {
  const entity = await this.repo.findById(id, orgId);
  this.validateTransition(entity.status, newStatus);
  const updated = await this.repo.updateStatus(id, orgId, newStatus);
  this.eventEmitter.emit('entity.status_changed', { id, newStatus });
  return this.mapToDto(updated);
}
```

### 4. Repository Pattern

Repositories should:
1. Always filter by `orgId` for multi-tenant safety
2. Return raw entities (services map to DTOs)
3. Use Prisma's include/select for eager loading
4. Handle soft deletes consistently

Example:
```typescript
async findById(id: string, orgId: string) {
  return this.prisma.entity.findFirst({
    where: { id, organization_id: orgId, deleted_at: null },
    include: { relationships: true },
  });
}
```

### 5. Event-Driven Side Effects

Major state changes should emit events:
- Lead status changes → Lead events
- Proposal sent → Notification event
- Invoice issued → Email + Reminder job
- Payment received → Payment event + Analytics
- Contract signed → Audit log + Webhook
- Meeting scheduled → Invitation emails + Reminder job

Events trigger:
- Email notifications (queued)
- In-app notifications (real-time)
- Audit logging
- Analytics tracking
- Webhook dispatching
- Scheduled reminder jobs

### 6. Status Machines

Implement valid state transitions:

```typescript
const VALID_TRANSITIONS = {
  NEW: ['CONTACTED', 'ARCHIVED'],
  CONTACTED: ['QUALIFIED', 'LOST'],
  QUALIFIED: ['PROPOSAL_SENT', 'LOST'],
  PROPOSAL_SENT: ['WON', 'LOST'],
  WON: ['ARCHIVED'],
  LOST: ['ARCHIVED'],
};

validateTransition(current: string, target: string) {
  if (!VALID_TRANSITIONS[current]?.includes(target)) {
    throw new StateTransitionException(current, target);
  }
}
```

---

## API Endpoint Patterns

### Lead Management
```
POST   /api/v1/leads              # Create lead
GET    /api/v1/leads              # List leads (with filtering)
GET    /api/v1/leads/:id          # Get single lead
POST   /api/v1/leads/:id/qualify  # Qualify lead
POST   /api/v1/leads/:id/status   # Update status
POST   /api/v1/leads/:id/convert-to-client  # Convert to client
GET    /api/v1/leads/stats        # Get statistics
```

### Proposal Management
```
POST   /api/v1/proposals                  # Create proposal
GET    /api/v1/proposals                  # List proposals
GET    /api/v1/proposals/:id              # Get proposal
PUT    /api/v1/proposals/:id              # Update proposal
POST   /api/v1/proposals/:id/send         # Send to client
POST   /api/v1/proposals/:id/approve      # Approve proposal
POST   /api/v1/proposals/:id/accept       # Accept proposal
GET    /api/v1/proposals/:id/pdf          # Download as PDF
```

### Invoice Management
```
POST   /api/v1/invoices            # Create invoice
GET    /api/v1/invoices            # List invoices
GET    /api/v1/invoices/:id        # Get invoice
PUT    /api/v1/invoices/:id        # Update invoice
POST   /api/v1/invoices/:id/issue  # Issue to client
GET    /api/v1/invoices/:id/pdf    # Download PDF
POST   /api/v1/invoices/:id/send   # Send email
```

### Payment Processing
```
POST   /api/v1/payments/intents            # Create payment intent
POST   /api/v1/payments/:id/confirm        # Confirm payment
GET    /api/v1/payments/:id                # Get payment status
GET    /api/v1/payments                    # List payments
POST   /api/v1/payments/:id/refund         # Refund payment
POST   /api/v1/webhooks/stripe             # Stripe webhooks
```

---

## Database Management

### Running Migrations

```bash
# Create migration
npx prisma migrate dev --name add_new_field

# Apply migration to production
npx prisma migrate deploy

# View migration status
npx prisma migrate status

# Reset database (dev only)
npx prisma migrate reset
```

### Seeding Database

```bash
# Create seed file: prisma/seed.ts
# Add to package.json: "prisma": { "seed": "ts-node prisma/seed.ts" }

npx prisma db seed
```

### Performance Optimization

```typescript
// Use select for specific fields (faster than include all)
const user = await prisma.user.findUnique({
  where: { id: '123' },
  select: { id: true, email: true, first_name: true },
});

// Use pagination for large result sets
const [items, total] = await Promise.all([
  prisma.lead.findMany({ skip: 0, take: 20 }),
  prisma.lead.count(),
]);

// Use raw queries for complex aggregations
const stats = await prisma.$queryRaw`
  SELECT status, COUNT(*) as count
  FROM Lead
  WHERE organization_id = ${orgId}
  GROUP BY status;
`;
```

---

## Authentication Flow

### Register New User
```
1. POST /api/v1/auth/register with email, password, name
2. AuthService hashes password with argon2
3. Creates user with PENDING_VERIFICATION status
4. Returns access token + refresh token
5. Frontend redirects to email verification page
```

### Login
```
1. POST /api/v1/auth/login with email, password
2. AuthService finds user by email
3. Verifies password with argon2.verify()
4. Checks brute force attempts and account lockout
5. Returns short-lived JWT (15 min) + refresh token (7 days)
6. Token stored in Redis for revocation
```

### Token Refresh
```
1. Client detects expired JWT
2. POST /api/v1/auth/refresh with refresh token
3. AuthService verifies refresh token (must not be revoked, not expired)
4. Returns new access token
5. No refresh token update (same token continues to work)
```

### Logout
```
1. POST /api/v1/auth/logout with refresh token
2. AuthService marks refresh token as revoked in Redis
3. Session invalidated immediately
```

---

## Payment Integration

### Stripe Integration

```typescript
// 1. Create Payment Intent (before sending to client)
const intent = await stripe.paymentIntents.create({
  amount: 5000, // cents
  currency: 'usd',
  metadata: { invoiceId },
});

// 2. Return clientSecret to frontend
// Frontend collects payment details using Stripe Elements

// 3. Confirm payment (after client submits details)
const confirmed = await stripe.paymentIntents.confirm(
  intent.id,
  { payment_method: pmId },
);

// 4. Listen for webhook confirmation
stripe.webhooks.constructEvent(body, signature, secret);
// Event: payment_intent.succeeded

// 5. Update invoice and send confirmation email
await updateInvoice(invoiceId, { status: 'PAID' });
await sendConfirmationEmail(clientEmail);
```

---

## File Upload & Storage

### S3 Integration

```typescript
// Upload file to S3
const s3 = new AWS.S3();
const params = {
  Bucket: 'consulting-files',
  Key: `org-${orgId}/proposal-${proposalId}.pdf`,
  Body: fileBuffer,
  ContentType: 'application/pdf',
  ServerSideEncryption: 'AES256',
};
await s3.upload(params).promise();

// Generate signed URL for download (valid for 24 hours)
const signedUrl = s3.getSignedUrl('getObject', {
  Bucket: 'consulting-files',
  Key: `org-${orgId}/proposal-${proposalId}.pdf`,
  Expires: 24 * 60 * 60,
});

// Log access for audit trail
await createFileAccessLog({
  fileId,
  userId,
  action: 'download',
  ipAddress,
});
```

---

## Testing Guide

### Unit Tests
- Mock all external dependencies
- Test individual service methods
- Focus on business logic validation
- Use factories for test data

### Integration Tests
- Test entire workflow through API
- Use real database (with transaction rollback)
- Test cross-module interactions
- Verify events are emitted

### E2E Tests
- Full workflow from start to finish
- Real API calls
- Verify all side effects
- Test error scenarios

### Running Tests
```bash
npm test                 # Run all tests
npm test -- --watch     # Watch mode
npm test -- --coverage  # Coverage report
```

---

## Deployment Guide

### Development
```bash
docker-compose up                      # Start services
npm run typeorm migration:run          # Run migrations
npm run seed                           # Seed data
npm run start:dev                      # Start server
```

### Staging/Production
```bash
# Build Docker image
docker build -f docker/Dockerfile.prod -t consulting-api:1.0.0 .

# Push to registry
docker tag consulting-api:1.0.0 registry.example.com/consulting-api:1.0.0
docker push registry.example.com/consulting-api:1.0.0

# Deploy to Kubernetes
kubectl apply -f k8s/deployment.yaml
kubectl rollout status deployment/consulting-api

# Monitor deployment
kubectl logs -f deployment/consulting-api
kubectl describe deployment consulting-api
```

---

## Monitoring & Observability

### Health Checks
```
GET /health        # Liveness check (is app running?)
GET /ready         # Readiness check (can it serve requests?)
```

### Metrics to Track
- Request latency (p50, p95, p99)
- Error rate by endpoint
- Database query performance
- Queue processing time
- Payment success rate
- Email delivery rate

### Logging
```typescript
// Structured logging with context
this.logger.log('Proposal sent', {
  proposalId,
  clientId,
  amount,
  timestamp: new Date(),
});

// Errors with stack trace
this.logger.error('Payment failed', error.stack, {
  paymentId,
  error: error.message,
});
```

---

## Security Checklist

- ✅ All passwords hashed with argon2
- ✅ JWT tokens short-lived (15 min)
- ✅ Refresh tokens stored in database/Redis
- ✅ HTTPS only in production
- ✅ CORS properly configured
- ✅ Rate limiting on auth endpoints
- ✅ Input validation on all endpoints
- ✅ SQL injection prevented by Prisma ORM
- ✅ XSS prevention in message content
- ✅ CSRF tokens if needed (state-based sessions)
- ✅ Multi-tenancy enforced at repository level
- ✅ Audit logging for sensitive operations
- ✅ File uploads validated and scanned
- ✅ Secrets managed via environment variables
- ✅ Database encrypted at rest
- ✅ Sensitive data fields encrypted
- ✅ API keys rotated regularly

---

## Common Issues & Solutions

### Issue: "User is not member of any organization"
**Solution**: Ensure user is added to organization via OrganizationMember before JWT generation

### Issue: Database constraint violations
**Solution**: Check unique constraints in schema.prisma, especially org_id + field combinations

### Issue: Soft delete showing deleted records
**Solution**: Always include `deleted_at: null` in WHERE clauses

### Issue: Multi-tenancy breach (data from another org visible)
**Solution**: Audit all repository queries - every findMany/findFirst must filter by org_id

### Issue: Payment webhook not processing
**Solution**: Verify webhook secret in Stripe dashboard matches STRIPE_WEBHOOK_SECRET in .env

### Issue: Email queue jobs stuck
**Solution**: Check Redis connection, inspect queue with Bull Dashboard, review job data format

---

## Production Readiness Checklist

Before deploying to production:

- ✅ All tests passing with >80% coverage
- ✅ Database migrations tested
- ✅ Performance tested (load testing)
- ✅ Security scan completed
- ✅ Secrets management configured
- ✅ Monitoring and alerting configured
- ✅ Logging centralized
- ✅ Backup/restore procedure tested
- ✅ Disaster recovery plan documented
- ✅ Compliance requirements met
- ✅ Documentation complete
- ✅ Team trained
- ✅ Rollback procedure documented

---

## Next Steps After Setup

1. **Implement Auth First** - Get login/JWT working before other modules
2. **Test Multi-tenancy** - Verify data isolation between orgs
3. **Setup Monitoring** - Get observability in place early
4. **Document API** - Keep Swagger docs up to date
5. **Establish Patterns** - Other modules follow auth/leads patterns
6. **Integration Testing** - Test workflows end-to-end
7. **Performance Tuning** - Profile and optimize before production
8. **Security Review** - Third-party security audit recommended

---

## Support Resources

- NestJS Docs: https://docs.nestjs.com
- Prisma Docs: https://www.prisma.io/docs
- Stripe Integration: https://stripe.com/docs/api
- Redis: https://redis.io/docs
- Docker: https://docs.docker.com
- Kubernetes: https://kubernetes.io/docs

---

**This is a production-grade architecture designed to scale with your business. Follow the patterns consistently, test thoroughly, and monitor continuously.**
