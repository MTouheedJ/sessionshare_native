import { INestApplicationContext } from '@nestjs/common';
import { IoAdapter } from '@nestjs/platform-socket.io';
import type { Server, ServerOptions } from 'socket.io';

/** Socket.io adapter whose CORS origins come from runtime config rather than decorators. */
export class CorsIoAdapter extends IoAdapter {
  constructor(
    app: INestApplicationContext,
    private readonly origins: readonly string[],
  ) {
    super(app);
  }

  createIOServer(port: number, options?: ServerOptions): Server {
    const base = options ?? ({} as ServerOptions);
    return super.createIOServer(port, {
      ...base,
      cors: { origin: [...this.origins], credentials: true },
    }) as Server;
  }
}
