import test from 'node:test';
import assert from 'node:assert/strict';
import { lockViewportZoom } from '../src/viewport.js';

test('zoom gestures are cancelled while one-finger scrolling and normal wheel scrolling remain available', () => {
  const listeners = new Map();
  lockViewportZoom({ addEventListener(name, callback, options) {
    assert.equal(options.passive, false);
    listeners.set(name, callback);
  } });
  const dispatch = (name, props = {}) => {
    let prevented = false;
    listeners.get(name)({ ...props, preventDefault() { prevented = true; } });
    return prevented;
  };
  for (const name of ['gesturestart','gesturechange','gestureend']) assert.equal(dispatch(name), true);
  for (const name of ['touchstart']) {
    assert.equal(dispatch(name, { touches: [{}] }), false);
    assert.equal(dispatch(name, { touches: [{}, {}] }), true);
  }
  assert.equal(listeners.has('touchmove'),false,'ordinary scrolling has no global blocking move listener');
  assert.equal(dispatch('wheel', { ctrlKey: false }), false);
  assert.equal(dispatch('wheel', { ctrlKey: true }), true);
});
