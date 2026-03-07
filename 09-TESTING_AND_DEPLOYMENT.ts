// Testing Strategy
// ================================================================================

// test/unit/auth.service.spec.ts
/**
 * Unit tests for authentication service
 */
import { Test, TestingModule } from '@nestjs/testing';
import { AuthService } from '../../src/modules/auth/auth.service';
import { UsersService } from '../../src/modules/users/users.service';
import { PrismaService } from '../../src/providers/database/database.service';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { UnauthorizedException, BadRequestException } from '@nestjs/common';

describe('AuthService', () => {
  let service: AuthService;
  let prisma: PrismaService;
  let usersService: UsersService;
  let jwtService: JwtService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        {
          provide: UsersService,
          useValue: {
            findByEmail: jest.fn(),
            create: jest.fn(),
          },
        },
        {
          provide: PrismaService,
          useValue: {
            user: {
              findUnique: jest.fn(),
              create: jest.fn(),
              update: jest.fn(),
            },
            refreshToken: {
              findFirst: jest.fn(),
              create: jest.fn(),
              updateMany: jest.fn(),
            },
            passwordReset: {
              findUnique: jest.fn(),
              create: jest.fn(),
              update: jest.fn(),
            },
          },
        },
        {
          provide: JwtService,
          useValue: {
            sign: jest.fn(),
            verify: jest.fn(),
          },
        },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key) => {
              const config = {
                JWT_SECRET: 'test-secret',
                FRONTEND_URL: 'http://localhost:3000',
              };
              return config[key];
            }),
          },
        },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
    prisma = module.get<PrismaService>(PrismaService);
    usersService = module.get<UsersService>(UsersService);
    jwtService = module.get<JwtService>(JwtService);
  });

  describe('login', () => {
    it('should return tokens for valid credentials', async () => {
      const mockUser = {
        id: 'user-123',
        email: 'test@example.com',
        password_hash: '$argon2id$v=19$m=65536$...',
        organization_memberships: [
          {
            organization_id: 'org-123',
            role: 'CONSULTANT',
            organization: {
              name: 'Test Org',
              slug: 'test-org',
            },
          },
        ],
        status: 'ACTIVE',
      };

      jest.spyOn(prisma.user, 'findUnique').mockResolvedValue(mockUser as any);
      jest.spyOn(jwtService, 'sign').mockReturnValue('mock-jwt-token');

      const result = await service.login('test@example.com', 'password123');

      expect(result).toHaveProperty('accessToken');
      expect(result).toHaveProperty('refreshToken');
      expect(result).toHaveProperty('user');
      expect(result.user.email).toBe('test@example.com');
    });

    it('should throw UnauthorizedException for non-existent user', async () => {
      jest.spyOn(prisma.user, 'findUnique').mockResolvedValue(null);

      expect(
        service.login('nonexistent@example.com', 'password123'),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('should throw UnauthorizedException for invalid password', async () => {
      const mockUser = {
        id: 'user-123',
        email: 'test@example.com',
        password_hash: '$argon2id$invalid$hash',
        organization_memberships: [],
      };

      jest.spyOn(prisma.user, 'findUnique').mockResolvedValue(mockUser as any);

      expect(
        service.login('test@example.com', 'wrongpassword'),
      ).rejects.toThrow(UnauthorizedException);
    });
  });

  describe('refreshAccessToken', () => {
    it('should return new access token for valid refresh token', async () => {
      const mockRefreshToken = {
        user: {
          id: 'user-123',
          email: 'test@example.com',
          organization_memberships: [
            {
              organization_id: 'org-123',
              role: 'CONSULTANT',
            },
          ],
        },
        expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000),
      };

      jest.spyOn(prisma.refreshToken, 'findFirst').mockResolvedValue(mockRefreshToken as any);
      jest.spyOn(jwtService, 'sign').mockReturnValue('new-access-token');

      const result = await service.refreshAccessToken('valid-refresh-token');

      expect(result).toHaveProperty('accessToken');
      expect(result.accessToken).toBe('new-access-token');
    });

    it('should throw UnauthorizedException for expired refresh token', async () => {
      jest.spyOn(prisma.refreshToken, 'findFirst').mockResolvedValue(null);

      expect(
        service.refreshAccessToken('expired-refresh-token'),
      ).rejects.toThrow(UnauthorizedException);
    });
  });
});

// test/integration/lead-to-client.integration.spec.ts
/**
 * Integration test for lead-to-client conversion flow
 */
import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import * as request from 'supertest';
import { AppModule } from '../../src/app.module';
import { PrismaService } from '../../src/providers/database/database.service';

describe('Lead to Client Conversion Flow (Integration)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let authToken: string;
  let orgId: string;
  let userId: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();

    prisma = moduleFixture.get<PrismaService>(PrismaService);

    // Setup: Create organization, user, and get auth token
    const org = await prisma.organization.create({
      data: {
        name: 'Test Consulting',
        slug: 'test-consulting',
      },
    });
    orgId = org.id;

    const user = await prisma.user.create({
      data: {
        email: 'consultant@test.com',
        first_name: 'John',
        last_name: 'Doe',
        password_hash: 'hashed-password',
        status: 'ACTIVE',
      },
    });
    userId = user.id;

    await prisma.organizationMember.create({
      data: {
        organization_id: orgId,
        user_id: userId,
        role: 'CONSULTANT',
      },
    });

    // Authenticate to get token
    const loginRes = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({
        email: 'consultant@test.com',
        password: 'password123',
      });

    authToken = loginRes.body.data.accessToken;
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it('should convert lead through entire workflow', async () => {
    // 1. Create a lead
    const createLeadRes = await request(app.getHttpServer())
      .post('/api/v1/leads')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        firstName: 'Jane',
        lastName: 'Smith',
        email: 'jane@example.com',
        company: 'Acme Corp',
        title: 'CEO',
        source: 'website',
        message: 'Interested in consulting services',
        budgetRange: '$50k-$100k',
        timeline: 'this_quarter',
      });

    expect(createLeadRes.status).toBe(201);
    const leadId = createLeadRes.body.data.id;
    expect(createLeadRes.body.data.status).toBe('NEW');

    // 2. Qualify the lead
    const qualifyRes = await request(app.getHttpServer())
      .post(`/api/v1/leads/${leadId}/qualify`)
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        notes: 'Meets all criteria, great fit for our services',
      });

    expect(qualifyRes.status).toBe(200);
    expect(qualifyRes.body.data.status).toBe('QUALIFIED');

    // 3. Get lead to verify qualified status
    const getLeadRes = await request(app.getHttpServer())
      .get(`/api/v1/leads/${leadId}`)
      .set('Authorization', `Bearer ${authToken}`);

    expect(getLeadRes.status).toBe(200);
    expect(getLeadRes.body.data.qualifiedAt).toBeDefined();

    // 4. Convert lead to client
    const convertRes = await request(app.getHttpServer())
      .post(`/api/v1/leads/${leadId}/convert-to-client`)
      .set('Authorization', `Bearer ${authToken}`);

    expect(convertRes.status).toBe(200);
    expect(convertRes.body.data.status).toBe('WON');
    expect(convertRes.body.data.convertedAt).toBeDefined();

    // 5. Verify client was created
    const clientRes = await request(app.getHttpServer())
      .get('/api/v1/clients')
      .set('Authorization', `Bearer ${authToken}`);

    expect(clientRes.status).toBe(200);
    const newClient = clientRes.body.data.find(
      (c: any) => c.contactEmail === 'jane@example.com',
    );
    expect(newClient).toBeDefined();
  });
});

// test/e2e/consulting-flow.e2e.spec.ts
/**
 * End-to-end test of complete consulting workflow
 */
describe('Complete Consulting Workflow (E2E)', () => {
  // Full workflow: Lead → Proposal → Contract → Invoice → Payment
  // This would test the entire business flow with real data
});

// DEPLOYMENT & CONFIGURATION
// ================================================================================

// docker/Dockerfile (Development)
/*
FROM node:18-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .

RUN npm run build

EXPOSE 3000

CMD ["node", "dist/main.js"]
*/

// docker/Dockerfile.prod (Production)
/*
# Build stage
FROM node:18-alpine AS builder

WORKDIR /app

COPY package*.json ./
RUN npm ci --only=production

COPY . .
RUN npm run build
RUN npm prune --omit=dev

# Runtime stage
FROM node:18-alpine

WORKDIR /app

RUN addgroup -g 1001 -S nodejs
RUN adduser -S nestjs -u 1001

COPY --from=builder --chown=nestjs:nodejs /app/node_modules ./node_modules
COPY --from=builder --chown=nestjs:nodejs /app/dist ./dist
COPY --from=builder --chown=nestjs:nodejs /app/package*.json ./

USER nestjs

EXPOSE 3000

HEALTHCHECK --interval=10s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3000/health', (r) => {if (r.statusCode !== 200) throw new Error(r.statusCode)})"

CMD ["node", "dist/main.js"]
*/

// docker-compose.yml (Development)
/*
version: '3.8'

services:
  app:
    build: .
    ports:
      - "3000:3000"
    environment:
      DATABASE_URL: postgresql://postgres:postgres@db:5432/consulting_dev
      REDIS_URL: redis://redis:6379
      JWT_SECRET: dev-secret-key
      STRIPE_SECRET_KEY: sk_test_...
    depends_on:
      - db
      - redis
    volumes:
      - .:/app
      - /app/node_modules

  db:
    image: postgres:15-alpine
    environment:
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: postgres
      POSTGRES_DB: consulting_dev
    ports:
      - "5432:5432"
    volumes:
      - postgres_data:/var/lib/postgresql/data

  redis:
    image: redis:7-alpine
    ports:
      - "6379:6379"

volumes:
  postgres_data:
*/

// Configuration: .env.example
/*
# Application
NODE_ENV=production
APP_NAME=consulting-platform
APP_URL=https://api.consulting.com

# Database
DATABASE_URL=postgresql://user:password@localhost:5432/consulting_prod
DATABASE_POOL_SIZE=20
DATABASE_IDLE_TIMEOUT=30000

# Redis
REDIS_URL=redis://localhost:6379
REDIS_KEY_PREFIX=consulting:

# JWT
JWT_SECRET=your-super-secret-key-here
JWT_EXPIRATION=900000

# Refresh Token
REFRESH_TOKEN_EXPIRATION=604800000

# Email
MAIL_HOST=smtp.sendgrid.net
MAIL_PORT=587
MAIL_USERNAME=apikey
MAIL_PASSWORD=your-sendgrid-api-key
MAIL_FROM=noreply@consulting.com
MAIL_FROM_NAME=Consulting Platform

# Stripe
STRIPE_SECRET_KEY=sk_live_...
STRIPE_PUBLISHABLE_KEY=pk_live_...
STRIPE_WEBHOOK_SECRET=whsec_...

# AWS S3
AWS_REGION=us-east-1
AWS_S3_BUCKET=consulting-files
AWS_S3_FOLDER=uploads
AWS_ACCESS_KEY_ID=...
AWS_SECRET_ACCESS_KEY=...

# Frontend
FRONTEND_URL=https://app.consulting.com

# Logging
LOG_LEVEL=info
LOG_FORMAT=json

# Security
CORS_ORIGIN=https://app.consulting.com
RATE_LIMIT_WINDOW_MS=900000
RATE_LIMIT_MAX_REQUESTS=100
*/

// src/main.ts (Entry point with all setup)
/*
import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { Logger, ValidationPipe } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';
import helmet from 'helmet';
import compression from 'compression';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    logger: ['log', 'error', 'warn', 'debug', 'verbose'],
  });

  const configService = app.get(ConfigService);
  const logger = new Logger('Bootstrap');

  // Security middleware
  app.use(helmet());
  app.use(compression());

  // CORS
  app.enableCors({
    origin: configService.get('CORS_ORIGIN'),
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
  });

  // Validation
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: {
        enableImplicitConversion: true,
      },
    }),
  );

  // Global exception handler
  app.useGlobalFilters(new HttpExceptionFilter());

  // API Versioning
  app.setGlobalPrefix('api');

  // Swagger/OpenAPI Documentation
  if (configService.get('NODE_ENV') !== 'production') {
    const config = new DocumentBuilder()
      .setTitle('Consulting Management Platform API')
      .setDescription('API for consulting management platform')
      .setVersion('1.0')
      .addBearerAuth()
      .build();

    const document = SwaggerModule.createDocument(app, config);
    SwaggerModule.setup('api/docs', app, document);
  }

  // Health check endpoint
  app.get('/health', () => ({ status: 'ok' }));
  app.get('/ready', async (req, res) => {
    try {
      // Check database connection
      const prisma = app.get(PrismaService);
      await prisma.$queryRaw`SELECT 1`;

      // Check Redis connection
      const redis = app.get(RedisService);
      await redis.ping();

      res.json({ status: 'ready' });
    } catch (error) {
      res.status(503).json({ status: 'not ready', error: error.message });
    }
  });

  const port = configService.get('PORT') || 3000;
  await app.listen(port);

  logger.log(`Application running on http://localhost:${port}`);
  logger.log(
    `Swagger docs available at http://localhost:${port}/api/docs`,
  );
}

bootstrap().catch((err) => {
  new Logger('Bootstrap').error('Failed to start application', err);
  process.exit(1);
});
*/

// Kubernetes Deployment (k8s/deployment.yaml)
/*
apiVersion: apps/v1
kind: Deployment
metadata:
  name: consulting-api
  labels:
    app: consulting-api
spec:
  replicas: 3
  strategy:
    type: RollingUpdate
    rollingUpdate:
      maxSurge: 1
      maxUnavailable: 0
  selector:
    matchLabels:
      app: consulting-api
  template:
    metadata:
      labels:
        app: consulting-api
    spec:
      containers:
      - name: consulting-api
        image: consulting-api:1.0.0
        imagePullPolicy: Always
        ports:
        - containerPort: 3000
          name: http
        env:
        - name: NODE_ENV
          value: "production"
        - name: DATABASE_URL
          valueFrom:
            secretKeyRef:
              name: app-secrets
              key: database-url
        - name: REDIS_URL
          valueFrom:
            secretKeyRef:
              name: app-secrets
              key: redis-url
        - name: JWT_SECRET
          valueFrom:
            secretKeyRef:
              name: app-secrets
              key: jwt-secret
        resources:
          requests:
            cpu: 250m
            memory: 512Mi
          limits:
            cpu: 500m
            memory: 1Gi
        livenessProbe:
          httpGet:
            path: /health
            port: 3000
          initialDelaySeconds: 30
          periodSeconds: 10
          timeoutSeconds: 5
          failureThreshold: 3
        readinessProbe:
          httpGet:
            path: /ready
            port: 3000
          initialDelaySeconds: 10
          periodSeconds: 5
          timeoutSeconds: 3
          failureThreshold: 2

---
apiVersion: v1
kind: Service
metadata:
  name: consulting-api
spec:
  selector:
    app: consulting-api
  ports:
  - protocol: TCP
    port: 80
    targetPort: 3000
  type: LoadBalancer
*/

// Production Health & Monitoring
/*
Key Metrics to Monitor:
- API Response Time (p50, p95, p99)
- Error Rate (4xx, 5xx by endpoint)
- Database Query Performance
- Redis Cache Hit Rate
- Queue Processing Latency
- Background Job Success/Failure Rate

Tools:
- Prometheus for metrics collection
- Grafana for visualization
- ELK Stack for centralized logging
- DataDog or New Relic for APM
*/

// Database Backup Strategy
/*
- Automated daily backups to S3
- Point-in-time recovery enabled
- Replication to standby instance
- Test restore procedures monthly
- Encryption at rest and in transit
*/

// Deployment Checklist
/*
Pre-deployment:
✓ Run full test suite
✓ Code review and approval
✓ Database migration testing
✓ Dependency security scan
✓ Performance profiling
✓ Staging environment validation

Deployment:
✓ Backup production database
✓ Execute database migrations
✓ Blue-green deployment strategy
✓ Monitor error rates during rollout
✓ Health check validation

Post-deployment:
✓ Smoke tests
✓ Monitor key metrics
✓ Customer validation
✓ Document any issues
✓ Update deployment log
*/
