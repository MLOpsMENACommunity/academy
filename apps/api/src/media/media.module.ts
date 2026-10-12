import { Module } from '@nestjs/common';
import { AdminMediaController, MediaController } from './media.controller';
import { MediaService } from './media.service';

@Module({
  controllers: [MediaController, AdminMediaController],
  providers: [MediaService],
})
export class MediaModule {}
