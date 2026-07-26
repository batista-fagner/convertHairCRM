import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { IgPost } from './ig-post.entity';
import { IgPostsService } from './ig-posts.service';
import { IgPostsController } from './ig-posts.controller';

@Module({
  imports: [TypeOrmModule.forFeature([IgPost])],
  controllers: [IgPostsController],
  providers: [IgPostsService],
})
export class IgPostsModule {}
