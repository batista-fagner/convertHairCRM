import { Body, Controller, Get, Param, Patch, Post, Req } from '@nestjs/common';
import { AuthService } from './auth.service';
import { Public, Roles } from './auth.decorators';
import { UserRole } from './user.entity';

@Controller('auth')
export class AuthController {
  constructor(private auth: AuthService) {}

  @Public()
  @Post('login')
  login(@Body() body: { email: string; password: string }) {
    return this.auth.login(body.email, body.password);
  }

  @Get('me')
  me(@Req() req: any) {
    return this.auth.me(req.user.sub);
  }

  @Roles('socio')
  @Get('users')
  listUsers() {
    return this.auth.list();
  }

  @Roles('socio')
  @Post('users')
  createUser(@Body() body: { name: string; email: string; role?: UserRole; password?: string }) {
    return this.auth.create(body);
  }

  @Roles('socio')
  @Patch('users/:id')
  updateUser(@Param('id') id: string, @Body() body: { name?: string; role?: UserRole; active?: boolean }, @Req() req: any) {
    return this.auth.update(id, body, req.user.sub);
  }

  @Roles('socio')
  @Post('users/:id/reset-access')
  resetAccess(@Param('id') id: string) {
    return this.auth.resetAccess(id);
  }
}
