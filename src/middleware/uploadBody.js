'use strict';

const express = require('express');
const { ApiError } = require('./errorHandler');
const { config } = require('../services/fleetFiles');
const { MiB, csvLimit } = require('../../public/js/upload-rules');
const { avatarLimits } = require('../services/uploadValidation');

function signedIn(req, res, next) {
  if (!req.session?.user) return res.status(401).json({ error: 'Not authenticated' });
  next();
}

function parse(req, res, next, { limit, jsonLimit, reason, mixed = false }) {
  const parser = limit && req.is('application/octet-stream')
    ? express.raw({ limit, inflate: false })
    : req.is('application/json')
      ? express.json({ limit: jsonLimit, inflate: false })
      : null;
  if (!parser) return next(new ApiError(415, 'Use a supported upload request format.', { code: 'FILE_ENCODING' }));
  parser(req, res, error => {
    if (!error) {
      req.uploadBody = !mixed || req.body?.avatar !== undefined;
      return next();
    }
    if (error.status === 413) return next(new ApiError(413, reason, { code: 'FILE_TOO_LARGE' }));
    return next(new ApiError(400, 'The upload request could not be read.', { code: 'FILE_ENCODING' }));
  });
}

module.exports = app => {
  app.post('/api/fleet-files/:type/:id/:kind', signedIn, async (req, res, next) => {
    const c = await config();
    if (!c.enabled) return next(new ApiError(403, 'File uploads are turned off.', { code: 'FILE_DISABLED' }));
    req.uploadConfig = c;
    const limit = c.maxMB * MiB;
    parse(req, res, next, { limit, jsonLimit: 4 * Math.ceil(limit / 3) + 8192, reason: `The file exceeds the ${c.maxMB} MB limit.` });
  });
  app.post('/api/ts/events/:id/import-schedule', signedIn, (req, res, next) => {
    parse(req, res, next, { limit: csvLimit, jsonLimit: 6 * csvLimit + 8192, reason: 'The file exceeds the 1 MB limit.' });
  });
  app.post('/api/me/avatar', signedIn, (req, res, next) => {
    parse(req, res, next, { jsonLimit: avatarLimits.profile + 8192, reason: 'The avatar exceeds the upload limit.' });
  });
  const parseUserBody = (req, res, next) => {
    if (!req.is('application/json')) return next();
    parse(req, res, next, { jsonLimit: avatarLimits.admin + 65536, reason: 'The user request exceeds the upload limit.', mixed: true });
  };
  app.post('/api/users', signedIn, parseUserBody);
  app.put('/api/users/:id', signedIn, parseUserBody);
};
