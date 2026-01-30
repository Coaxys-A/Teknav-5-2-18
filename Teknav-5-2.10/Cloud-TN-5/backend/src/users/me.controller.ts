import { Controller, Get, UseGuards, Req, HttpCode, HttpStatus } from '@nestjs/common';
import { UserService } from './user.service';

/**
 * Me Controller
 *
 * Implements /api/me endpoint.
 */

@Controller('api/me')
@UseGuards(/* AuthGuard - Applied globally or globally, skipping here for simplicity */)
export class MeController {
  constructor(private readonly userService: UserService) {}

  @Get()
  @HttpCode(HttpStatus.OK)
  async getMe(@Req() req: any): Promise<any> {
    const sessionId = req.sessionId;
    const deviceId = req.headers['x-device-id'] || sessionId;

    if (!sessionId) {
      throw new Error('Session ID missing');
    }

    const me = await this.userService.getMe(sessionId, deviceId);
    return { data: me };
  }
}
