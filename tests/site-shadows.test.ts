import { expect, it } from 'vitest';
import * as THREE from 'three';
import { clearSiteShadow, siteShadowUniforms as u, updateSiteShadow } from '../src/render/site/shadows';

it('binds r186 comparison depth storage and releases it with the owning scene', () => {
  const empty = u.uSiteShadowMap.value;
  const light = new THREE.DirectionalLight();
  updateSiteShadow(light, true);
  expect(u.uSiteShadowEnabled.value).toBe(0);
  const map = new THREE.WebGLRenderTarget(1024, 1024);
  map.depthTexture = new THREE.DepthTexture(1024, 1024);
  light.shadow.map = map;
  updateSiteShadow(light, true);
  expect(u.uSiteShadowMap.value).toBe(map.depthTexture);
  expect(u.uSiteShadowMatrix.value).toBe(light.shadow.matrix);
  expect(u.uSiteShadowEnabled.value).toBe(1);
  updateSiteShadow(light, false);
  expect(u.uSiteShadowMap.value).toBe(empty);
  expect(u.uSiteShadowEnabled.value).toBe(0);
  updateSiteShadow(light, true);
  clearSiteShadow();
  expect(u.uSiteShadowMap.value).toBe(empty);
  expect(u.uSiteShadowEnabled.value).toBe(0);
  map.dispose();
});
