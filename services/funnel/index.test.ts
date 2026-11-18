import assert from 'node:assert/strict';
import test from 'node:test';
import { buildLandingViewContentEventId } from './index.js';

test('buildLandingViewContentEventId matches the browser event ID convention', () => {
  assert.equal(
    buildLandingViewContentEventId('course-123', '12345678-abcd-efgh'),
    'view_content_course-123_12345678'
  );
});
