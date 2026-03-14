import { Request, Response, NextFunction } from 'express';
import {
  createLogger,
  APIError,
  constants,
  decryptString,
  validateConfig,
  Resource,
  StremioTransformer,
  UserRepository,
  Env,
} from '@aiostreams/core';

const logger = createLogger('server');

// Valid resources that require authentication
const VALID_RESOURCES = [
  ...constants.RESOURCES,
  'manifest.json',
  'configure',
  'manifest',
  'streams',
];

export const zxyConfigMiddleware = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  const userId = req.query.uid?.toString() ?? ""
  const encrypedPassword = req.query.pwd?.toString() ?? ""
  if ((userId.length == 0) || (encrypedPassword.length == 0)) {
    next(new APIError(constants.ErrorCode.USER_INVALID_DETAILS));
    return;
  }

  // Both uuid and encryptedPassword should be present since we mounted the router on this path
  if (!userId || !encrypedPassword) {
    next(new APIError(constants.ErrorCode.USER_INVALID_DETAILS));
    return;
  }

  try {
    // Check if user exists
    const userExists = await UserRepository.checkUserExists(userId);
    if (!userExists) {
      next(new APIError(constants.ErrorCode.USER_INVALID_DETAILS));
      return;
    }

    let password = undefined;

    // decrypt the encrypted password
    const { success: successfulDecryption, data: decryptedPassword } =
      decryptString(encrypedPassword!);
    if (!successfulDecryption) {
      next(new APIError(constants.ErrorCode.ENCRYPTION_ERROR));
      return;
    }


    // Get and validate user data
    let userData = await UserRepository.getUser(userId, decryptedPassword);

    if (!userData) {
      next(new APIError(constants.ErrorCode.USER_INVALID_DETAILS));
      return;
    }


    if (!req.body || Object.keys(req.body).length === 0 || !req.body.services) {
      next(new APIError(constants.ErrorCode.INVALID_SERVICES));
      return;
    }


    const disabled = req.body.disabled
    if (Array.isArray(disabled)) {
      userData.presets.forEach((preset, _) => {
        if (disabled.includes(preset.type)) {
          preset.enabled = false
        }
      })
    }


    userData.encryptedPassword = encrypedPassword;
    userData.uuid = userId;
    userData.ip = req.userIp;
    userData.services = req.body.services



    // Attach validated data to request
    req.userData = userData;
    req.uuid = userId;

    next();
  } catch (error: any) {
    logger.error(error.message);
    if (error instanceof APIError) {
      next(error);
    } else {
      next(new APIError(constants.ErrorCode.INTERNAL_SERVER_ERROR));
    }
  }
};
