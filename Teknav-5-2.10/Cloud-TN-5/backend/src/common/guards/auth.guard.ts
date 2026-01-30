import { Injectable, CanActivate, ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { SessionService } from '../security/session/session.service';
import { Request } from 'express';

/**
 * Auth Guard
 *
 * Validates session.
 * If session is invalid/revoked/expired, throws 401.
 */

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private readonly sessionService: SessionService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const sessionId = request.sessionId;
    const deviceId = request.headers['x-device-id'] || sessionId; // Fallback to sessionId for deviceId binding

    if (!sessionId) {
      throw new UnauthorizedException('Session ID missing');
    }

    try {
      const sessionData = await this.sessionService.validateSession(sessionId, deviceId);
      request.user = sessionData; // Attach to request
      request.sessionId = sessionId;
      return true;
    } catch (error) {
      throw new UnauthorizedException('Invalid session');
    }
  }
}
