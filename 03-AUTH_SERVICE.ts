// src/modules/auth/auth.service.ts
import { Injectable, UnauthorizedException, BadRequestException, ConflictException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as argon2 from 'argon2';
import { CreateUserDto } from '../users/dto/create-user.dto';
import { UsersService } from '../users/users.service';
import { PrismaService } from '../../providers/database/database.service';
import { ConfigService } from '@nestjs/config';
import { randomBytes } from 'crypto';

export interface JwtPayload {
  sub: string;      // user_id
  org_id: string;   // organization_id
  email: string;
  role: string;
}

@Injectable()
export class AuthService {
  constructor(
    private jwtService: JwtService,
    private usersService: UsersService,
    private prisma: PrismaService,
    private configService: ConfigService,
  ) {}

  /**
   * Register a new user
   */
  async register(createUserDto: CreateUserDto): Promise<{ accessToken: string; refreshToken: string }> {
    // Check if user exists
    const existingUser = await this.prisma.user.findUnique({
      where: { email: createUserDto.email },
    });

    if (existingUser) {
      throw new ConflictException('User with this email already exists');
    }

    // Hash password with argon2
    const hashedPassword = await argon2.hash(createUserDto.password, {
      type: argon2.argon2id,
      memoryCost: 2 ** 16,
      timeCost: 3,
      parallelism: 1,
    });

    // Create user in pending verification state
    const user = await this.prisma.user.create({
      data: {
        email: createUserDto.email,
        first_name: createUserDto.firstName,
        last_name: createUserDto.lastName,
        password_hash: hashedPassword,
        status: 'PENDING_VERIFICATION',
      },
    });

    // Generate email verification token (6-hour expiry)
    const verificationToken = randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 6 * 60 * 60 * 1000);

    // In a real app, you'd store this and send via email
    // await this.emailService.sendVerificationEmail(user.email, verificationToken);

    // Return tokens even though email not verified (frontend redirects to verification)
    const { accessToken, refreshToken } = await this.generateTokens(user.id, user.email, 'CONSULTANT');

    return { accessToken, refreshToken };
  }

  /**
   * Login with email and password
   */
  async login(email: string, password: string): Promise<{ accessToken: string; refreshToken: string; user: any }> {
    // Find user by email
    const user = await this.prisma.user.findUnique({
      where: { email },
      include: {
        organization_memberships: {
          where: { is_active: true },
          include: { organization: true },
        },
      },
    });

    if (!user) {
      // Don't reveal if email exists (security)
      throw new UnauthorizedException('Invalid credentials');
    }

    // Check if user is locked out (brute force protection)
    if (user.locked_until && user.locked_until > new Date()) {
      throw new UnauthorizedException('Account temporarily locked. Please try again later.');
    }

    // Verify password
    const isPasswordValid = await argon2.verify(user.password_hash, password);

    if (!isPasswordValid) {
      // Increment failed login attempts
      await this.prisma.user.update({
        where: { id: user.id },
        data: {
          login_attempts: user.login_attempts + 1,
          // Lock account after 5 failed attempts
          locked_until: user.login_attempts >= 4 ? new Date(Date.now() + 15 * 60 * 1000) : null,
        },
      });

      throw new UnauthorizedException('Invalid credentials');
    }

    // Reset failed login attempts
    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        login_attempts: 0,
        locked_until: null,
        last_login: new Date(),
      },
    });

    // Get the user's primary organization (could be selected by user)
    const primaryOrg = user.organization_memberships[0];

    if (!primaryOrg) {
      throw new UnauthorizedException('User is not member of any organization');
    }

    // Generate tokens
    const { accessToken, refreshToken } = await this.generateTokens(
      user.id,
      user.email,
      primaryOrg.role,
      primaryOrg.organization_id,
    );

    return {
      accessToken,
      refreshToken,
      user: {
        id: user.id,
        email: user.email,
        firstName: user.first_name,
        lastName: user.last_name,
        organization: {
          id: primaryOrg.organization_id,
          name: primaryOrg.organization.name,
          slug: primaryOrg.organization.slug,
        },
      },
    };
  }

  /**
   * Generate JWT access token and refresh token
   */
  async generateTokens(
    userId: string,
    email: string,
    role: string,
    orgId?: string,
  ): Promise<{ accessToken: string; refreshToken: string }> {
    // Get organization ID if not provided
    if (!orgId) {
      const membership = await this.prisma.organizationMember.findFirst({
        where: { user_id: userId, is_active: true },
      });
      orgId = membership?.organization_id || 'unknown';
    }

    const payload: JwtPayload = {
      sub: userId,
      email,
      org_id: orgId,
      role,
    };

    // Short-lived access token (15 minutes)
    const accessToken = this.jwtService.sign(payload, {
      secret: this.configService.get('JWT_SECRET'),
      expiresIn: '15m',
    });

    // Generate refresh token (7 days)
    const refreshTokenValue = randomBytes(64).toString('hex');
    const refreshTokenHash = await argon2.hash(refreshTokenValue);

    // Store refresh token in Redis or database
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    await this.prisma.refreshToken.create({
      data: {
        user_id: userId,
        token: refreshTokenHash,
        expires_at: expiresAt,
      },
    });

    // Return the raw token (only transmitted once to client)
    return {
      accessToken,
      refreshToken: refreshTokenValue,
    };
  }

  /**
   * Refresh access token using refresh token
   */
  async refreshAccessToken(refreshToken: string): Promise<{ accessToken: string }> {
    if (!refreshToken) {
      throw new UnauthorizedException('Refresh token is required');
    }

    // Find matching refresh token
    const storedToken = await this.prisma.refreshToken.findFirst({
      where: {
        expires_at: { gt: new Date() },
      },
      include: {
        user: {
          include: {
            organization_memberships: {
              where: { is_active: true },
              take: 1,
            },
          },
        },
      },
    });

    if (!storedToken) {
      throw new UnauthorizedException('Invalid or expired refresh token');
    }

    // Verify refresh token
    const isValid = await argon2.verify(storedToken.token, refreshToken);

    if (!isValid) {
      throw new UnauthorizedException('Invalid refresh token');
    }

    // Generate new access token
    const user = storedToken.user;
    const orgId = user.organization_memberships[0]?.organization_id || 'unknown';

    const payload: JwtPayload = {
      sub: user.id,
      email: user.email,
      org_id: orgId,
      role: user.organization_memberships[0]?.role || 'STAFF',
    };

    const accessToken = this.jwtService.sign(payload, {
      secret: this.configService.get('JWT_SECRET'),
      expiresIn: '15m',
    });

    return { accessToken };
  }

  /**
   * Logout - revoke refresh token
   */
  async logout(userId: string, refreshToken: string): Promise<void> {
    // Find and mark refresh token as revoked
    await this.prisma.refreshToken.updateMany({
      where: {
        user_id: userId,
      },
      data: {
        revoked_at: new Date(),
      },
    });

    // Optional: Invalidate all sessions for this user
    // In a production system, you might add the token to a blacklist
  }

  /**
   * Request password reset
   */
  async requestPasswordReset(email: string): Promise<void> {
    const user = await this.prisma.user.findUnique({ where: { email } });

    if (!user) {
      // Don't reveal if user exists (security)
      return;
    }

    // Generate reset token
    const resetToken = randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 1 * 60 * 60 * 1000); // 1 hour

    await this.prisma.passwordReset.create({
      data: {
        user_id: user.id,
        token: resetToken,
        expires_at: expiresAt,
      },
    });

    // Send email with reset link
    // const resetLink = `${this.configService.get('FRONTEND_URL')}/reset-password?token=${resetToken}`;
    // await this.emailService.sendPasswordResetEmail(email, resetLink);
  }

  /**
   * Reset password with token
   */
  async resetPassword(token: string, newPassword: string): Promise<void> {
    const passwordReset = await this.prisma.passwordReset.findUnique({
      where: { token },
    });

    if (!passwordReset) {
      throw new BadRequestException('Invalid reset token');
    }

    if (passwordReset.expires_at < new Date()) {
      throw new BadRequestException('Reset token has expired');
    }

    if (passwordReset.used_at) {
      throw new BadRequestException('Reset token has already been used');
    }

    // Hash new password
    const hashedPassword = await argon2.hash(newPassword, {
      type: argon2.argon2id,
      memoryCost: 2 ** 16,
      timeCost: 3,
      parallelism: 1,
    });

    // Update password and mark reset as used
    await Promise.all([
      this.prisma.user.update({
        where: { id: passwordReset.user_id },
        data: { password_hash: hashedPassword },
      }),
      this.prisma.passwordReset.update({
        where: { id: passwordReset.id },
        data: { used_at: new Date() },
      }),
    ]);

    // Revoke all existing refresh tokens
    await this.prisma.refreshToken.updateMany({
      where: { user_id: passwordReset.user_id },
      data: { revoked_at: new Date() },
    });
  }

  /**
   * Verify email address
   */
  async verifyEmail(token: string): Promise<void> {
    // In a production system, you'd verify the token
    // For now, mark user as verified
    // This would typically come from your email service
    throw new BadRequestException('Email verification not yet implemented');
  }

  /**
   * Validate JWT payload
   */
  async validateJwtPayload(payload: JwtPayload): Promise<any> {
    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      include: {
        organization_memberships: {
          where: { is_active: true },
        },
      },
    });

    if (!user) {
      throw new UnauthorizedException('User not found');
    }

    if (user.status === 'SUSPENDED' || user.status === 'DELETED') {
      throw new UnauthorizedException('User account is not active');
    }

    return user;
  }
}
