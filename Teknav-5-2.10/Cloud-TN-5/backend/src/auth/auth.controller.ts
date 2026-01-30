import { Body, Controller, Post, Get, Req, UseGuards, HttpException, HttpStatus } from '@nestjs/common';
import type { Request } from 'express';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import { LogoutDto } from './dto/logout.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RequestOtpDto } from './dto/request-otp.dto';
import { ThrottlerGuard } from '@nestjs/throttler';
import { CsrfService } from '../security/csrf/csrf.service';

@Controller('auth')
@UseGuards(ThrottlerGuard)
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly csrfService: CsrfService,
  ) {}

  @Get('csrf')
  @UseGuards(JwtAuthGuard)
  async getCsrfToken(@Req() req: Request & { user?: { sessionId: string } }) {
    const sessionId = req.user?.sessionId;
    if (!sessionId) {
      throw new HttpException('No active session', HttpStatus.UNAUTHORIZED);
    }
    const token = await this.csrfService.issueToken(sessionId);
    return { csrfToken: token };
  }

  @Post('login')
  async login(@Body() dto: LoginDto, @Req() req: Request) {
    return this.authService.login(dto.email, dto.password, {
      ip: req.ip,
      userAgent: req.headers['user-agent'],
      deviceId: dto.deviceId,
      otpCode: dto.otpCode,
    });
  }

  @Post('refresh')
  async refresh(@Body() dto: RefreshTokenDto) {
    return this.authService.refreshSession(dto.sessionId, dto.refreshToken);
  }

  @UseGuards(JwtAuthGuard)
  @Post('logout')
  async logout(@Body() dto: LogoutDto, @Req() req: Request & { user?: { id: number } }) {
    const userId = req.user?.id;
    await this.authService.logout(dto.sessionId, userId!);
    return { success: true };
  }

  @UseGuards(JwtAuthGuard)
  @Post('logout-all')
  async logoutAll(@Req() req: Request & { user?: { id: number } }) {
    const userId = req.user?.id;
    await this.authService.logoutAll(userId!);
    return { success: true };
  }

  @Post('request-otp')
  async requestOtp(@Body() dto: RequestOtpDto) {
    return this.authService.issueOtp(dto.email);
  }
}
