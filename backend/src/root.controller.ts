import { Controller, Get, Res } from '@nestjs/common';
import { Response } from 'express';

@Controller()
export class RootController {
  @Get()
  getRoot() {
    return {
      message: 'Welcome to the API',
      documentation: '/api/docs',
      health: '/api/health',
    };
  }

  @Get('favicon.ico')
  getFavicon(@Res() res: Response) {
    res.status(204).end();
  }
}
