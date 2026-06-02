#!/usr/bin/env node
// tools/test-file-capture.js — behavior checks for AIA material-image filtering.
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const scriptPath = path.join(root, 'modules', 'scripts', 'file-capture.js');
const script = fs.readFileSync(scriptPath, 'utf8');

function loadFileCapture() {
  const store = Object.create(null);
  const sandbox = {
    console,
    URL,
    Buffer,
    Date,
    $argument: 'mode=panel',
    $persistentStore: {
      read(key) {
        return store[key] || '';
      },
      write(value, key) {
        store[key] = value;
        return true;
      },
    },
    $notification: { post() {} },
    $done() {},
  };
  vm.runInNewContext(`${script}\n;globalThis.__fileCaptureExports = { buildFileItem, shouldSkipCaptureItem, hasStrongImageMaterialContext, isLikelyUiImage };`, sandbox, { filename: scriptPath });
  return sandbox.__fileCaptureExports;
}

const { buildFileItem, shouldSkipCaptureItem } = loadFileCapture();
const minBytes = 80000;

function buildImage(url, size, extra = {}) {
  return buildFileItem(url, {
    headers: {
      'content-type': extra.contentType || 'image/jpeg',
      'content-length': String(size),
    },
    status: 206,
    source: 'response',
    queryMode: 'redact',
    ...extra,
  });
}

const productMaterialImage = buildImage(
  'https://nav.aia.com.cn/sps/sps_product_core/static/png/214fb0532ce74d049ccaf45ad8a8a497.png',
  240000,
  { contentType: 'image/png' },
);
assert.equal(productMaterialImage.kind, 'image');
assert.equal(
  shouldSkipCaptureItem(productMaterialImage, minBytes),
  false,
  'AIA /sps/sps_product_core/static/png images are product-material candidates and should be captured',
);

const cmsBanner = buildImage(
  'https://nav.aia.com.cn/cms/file/images/2026/6/1780365006967_9823.jpg',
  569 * 1024,
);
assert.equal(
  shouldSkipCaptureItem(cmsBanner, minBytes),
  true,
  'AIA /cms/file/images large generic images are usually banners/ads and must not be archived without explicit material context',
);

const staleTermsContextImage = buildImage(
  'https://nav.aia.com.cn/cms/file/images/2026/6/1780365006967_9823.jpg',
  569 * 1024,
  { productName: '友邦测试保险产品计划', materialType: '产品条款' },
);
assert.equal(
  shouldSkipCaptureItem(staleTermsContextImage, minBytes),
  true,
  'AIA generic CMS images must not be kept merely because stale product/terms context was attached',
);

const explicitBrochureImage = buildImage(
  'https://nav.aia.com.cn/cms/file/images/2026/6/brochure-colorpage.jpg',
  569 * 1024,
  { productName: '友邦测试保险产品计划', materialType: '宣传彩页', pageTitle: '宣传彩页' },
);
assert.equal(
  shouldSkipCaptureItem(explicitBrochureImage, minBytes),
  false,
  'Explicit 一图/宣传彩页 context can keep an AIA image even when the object lives under CMS storage',
);

const tinyGenericIcon = buildImage(
  'https://nav.aia.com.cn/cms/file/images/icons/share.png',
  4096,
  { contentType: 'image/png' },
);
assert.equal(
  shouldSkipCaptureItem(tinyGenericIcon, minBytes),
  true,
  'Small UI icons remain filtered before archive submission',
);

console.log('file-capture image filter tests passed');
