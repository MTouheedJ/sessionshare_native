import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  CurrentDesktop,
  DesktopAuthGuard,
} from '../auth/guards/desktop-auth.guard';
import type { DesktopIdentity } from '../auth/interfaces/jwt-payload.interface';
import type { SignedUpload } from '../storage/storage.service';
import { PresignDownloadDto, UploadVaultDto } from './dto/vault-payload.dto';
import {
  VaultFetchResponse,
  VaultMetadata,
  VaultService,
} from './vault.service';

/** Desktop-only endpoints, authenticated with the hardware-bound desktop JWT. */
@Controller('owner/vault')
@UseGuards(DesktopAuthGuard)
export class VaultController {
  constructor(private readonly vaultService: VaultService) {}

  @Post('upload')
  @HttpCode(HttpStatus.OK)
  upload(
    @CurrentDesktop() identity: DesktopIdentity,
    @Body() dto: UploadVaultDto,
  ): Promise<VaultMetadata> {
    return this.vaultService.upload(identity, dto.payload);
  }

  @Get('fetch')
  fetch(
    @CurrentDesktop() identity: DesktopIdentity,
  ): Promise<VaultFetchResponse> {
    return this.vaultService.fetch(identity);
  }

  /** Owner-only: get a signed URL to upload one large encrypted artifact directly to storage. */
  @Post('artifacts/presign')
  @HttpCode(HttpStatus.OK)
  presignUpload(
    @CurrentDesktop() identity: DesktopIdentity,
  ): Promise<SignedUpload> {
    return this.vaultService.presignUpload(identity);
  }

  /** Signed URL to download an artifact belonging to this identity's owner. */
  @Post('artifacts/presign-download')
  @HttpCode(HttpStatus.OK)
  presignDownload(
    @CurrentDesktop() identity: DesktopIdentity,
    @Body() dto: PresignDownloadDto,
  ): Promise<{ url: string }> {
    return this.vaultService.presignDownload(identity, dto.objectKey);
  }
}
