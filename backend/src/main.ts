import { NestFactory } from '@nestjs/core';
import { json, urlencoded } from 'express';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.setGlobalPrefix('api');
  app.enableCors();
  app.use(json({ limit: '10mb' }));
  app.use(urlencoded({ extended: true, limit: '10mb' }));

  const port = process.env.PORT || 3001;
  await app.listen(port);
  console.log(`🚀 ConvertHairCRM running on: http://localhost:${port}/api`);
}

bootstrap();
