import assert from 'node:assert/strict';
import test from 'node:test';
import { DEFAULT_ENROLLMENT_TEMPLATES, hasUnknownPlaceholder, renderEnrollmentAnswer, renderLine } from './templates.js';

test('the default templates reproduce the original answer', () => {
  const answer = renderEnrollmentAnswer(DEFAULT_ENROLLMENT_TEMPLATES, [{ courseTitle: 'Una camisa', paymentStatus: 'paid' }, { courseTitle: 'Una falda', paymentStatus: 'weird' }]);
  assert.equal(answer, 'Encontré estas inscripciones:\n• Una camisa: figura como pagada.\n• Una falda: tiene un estado pendiente de revisión.\nEste es el estado registrado actualmente; un pago reciente puede tardar en reflejarse.');
});

test('custom templates change the wording and can drop the header or footer', () => {
  const templates = { ...DEFAULT_ENROLLMENT_TEMPLATES, header: '', footer: '', partial: 'Tu curso {curso} tiene una seña registrada.' };
  assert.equal(renderEnrollmentAnswer(templates, [{ courseTitle: 'Bordado', paymentStatus: 'partial' }]), 'Tu curso Bordado tiene una seña registrada.');
});

test('a course title cannot inject placeholders or replacement patterns', () => {
  assert.equal(renderLine('Curso {curso}', "$& {curso} $1"), "Curso $& {curso} $1");
});

test('only the course placeholder is allowed in templates', () => {
  assert.equal(hasUnknownPlaceholder('Hola {curso}'), false);
  assert.equal(hasUnknownPlaceholder('Hola {email}'), true);
  assert.equal(hasUnknownPlaceholder('{celular} {curso}'), true);
});
