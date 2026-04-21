import { Router, Request, Response, NextFunction } from 'express';
import {
  AIOStreams,
  AIOStreamResponse,
  Env,
  createLogger,
  StremioTransformer,
  Cache,
  IdParser,
} from '@aiostreams/core';
import { corsMiddleware } from '../../middlewares/cors.js';
const router: Router = Router();
const logger = createLogger('server');

router.use(corsMiddleware);

// block HEAD requests
router.use((req: Request, res: Response, next: NextFunction) => {
  if (req.method === 'HEAD') {
    res.status(405).send('Method not allowed');
  } else {
    next();
  }
});

router.post(
  '/:type/:id',
  async (req: Request, res: Response, next: NextFunction) => {
    // Check if we have user data (set by middleware for zxy routes)
    if (!req.userData) {
      // Return a response indicating configuration is needed
      res.status(200).json(
        StremioTransformer.createDynamicError('stream', {
          errorDescription: 'Please configure the addon first',
        })
      );
      return;
    }
    const transformer = new StremioTransformer(req.userData);

    const provideStreamData =
      Env.PROVIDE_STREAM_DATA !== undefined
        ? typeof Env.PROVIDE_STREAM_DATA === 'boolean'
          ? Env.PROVIDE_STREAM_DATA
          : Env.PROVIDE_STREAM_DATA.includes(req.requestIp || '')
        : (req.headers['user-agent']?.includes('AIOStreams/') ?? false);

    try {
      const { type, id } = req.params as { type: string; id: string };

      const aiostreams = await new AIOStreams(req.userData).initialise();

      const disableAutoplay = await aiostreams.shouldStopAutoPlay(type, id);

      const streamResponsePromise = aiostreams.getStreams(id, type);
      const subtitleResponsePromise = aiostreams.getSubtitles(id, type);
      const response = await Promise.all([streamResponsePromise, subtitleResponsePromise])
      const streamContext = aiostreams.getStreamContext();

      if (!streamContext) {
        throw new Error('Stream context not available');
      }

      const responseObject = {
        streams: (await transformer.transformStreams(
          response[0],
          streamContext.toFormatterContext(response[0].data.streams),
          { provideStreamData, disableAutoplay }
        )).streams,
        subtitles: transformer.transformSubtitles(response[1]).subtitles,
      }

      res
        .status(200)
        .json(
          responseObject,
        );
    } catch (error) {
      let errorMessage =
        error instanceof Error ? error.message : 'Unknown error';
      let errors = [
        {
          description: errorMessage,
        },
      ];
      if (transformer.showError('stream', errors)) {
        logger.error(
          `Unexpected error during stream retrieval: ${errorMessage}`,
          error
        );
        res.status(200).json(
          StremioTransformer.createDynamicError('stream', {
            errorDescription: errorMessage,
          })
        );
        return;
      }
      next(error);
    }

  }
);

export default router;
