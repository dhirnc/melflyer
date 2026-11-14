import * as THREE from 'three/webgpu';
import {
  pass, mrt, output, normalView, diffuseColor, velocity, metalness, roughness, vec2, vec4, float, add, sample, packNormalToRGB,
  unpackRGBToNormal, renderOutput, convertToTexture, uniform, mix,
} from 'three/tsl';
import { ssgi } from 'three/addons/tsl/display/SSGINode.js';
import { ssr } from 'three/addons/tsl/display/SSRNode.js';
import { traa } from 'three/addons/tsl/display/TRAANode.js';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';
import { painterly } from './painterly.js';

export function buildPipeline(renderer, scene, camera) {
  const pipeline = new THREE.RenderPipeline(renderer);
  const toggles = { gi: uniform(1), ssr: uniform(1), paint: uniform(1), ink: uniform(1) };

  const scenePass = pass(scene, camera);
  scenePass.setMRT(mrt({
    output,
    diffuseColor,
    normal: packNormalToRGB(normalView),
    velocity,
    metalrough: vec2(metalness, roughness),
  }));
  const colorTex = scenePass.getTextureNode('output');
  const diffuseTex = scenePass.getTextureNode('diffuseColor');
  const depthTex = scenePass.getTextureNode('depth');
  const normalTex = scenePass.getTextureNode('normal');
  const velocityTex = scenePass.getTextureNode('velocity');
  const metalRoughTex = scenePass.getTextureNode('metalrough');
  scenePass.getTexture('diffuseColor').type = THREE.UnsignedByteType;
  scenePass.getTexture('normal').type = THREE.UnsignedByteType;
  scenePass.getTexture('metalrough').type = THREE.UnsignedByteType;

  const sceneNormal = sample((uv) => unpackRGBToNormal(normalTex.sample(uv)));

  // Screen-space global illumination: contact shadows between buildings plus colour bounce off sunlit walls.
  const gi = ssgi(colorTex, depthTex, sceneNormal, camera);
  gi.sliceCount.value = 2;
  gi.stepCount.value = 8;
  gi.radius.value = 25;
  gi.thickness.value = 4;
  gi.giIntensity.value = 16;
  gi.aoIntensity.value = 1.5;
  gi.resolutionScale = 0.5;
  const ao = mix(float(1), gi.getAONode(), toggles.gi);
  const bounce = gi.getGINode().rgb.mul(toggles.gi);

  // Screen-space reflections: the Yarra, the bay and the glass towers mirror what is on screen.
  const reflections = ssr(colorTex, depthTex, sceneNormal, {
    metalnessNode: metalRoughTex.r,
    roughnessNode: metalRoughTex.g,
    camera,
  });
  reflections.maxDistance.value = 700;
  reflections.thickness.value = 9;
  reflections.quality.value = 0.45;
  reflections.resolutionScale = 0.5;
  reflections.intensity.value = 0.9;

  const lit = vec4(
    add(colorTex.rgb.mul(ao), diffuseTex.rgb.mul(bounce), reflections.rgb.mul(toggles.ssr)),
    colorTex.a
  );
  const resolved = traa(lit, depthTex, velocityTex, camera);
  const glow = bloom(resolved, 0.3, 0.55, 1.05);
  const display = convertToTexture(renderOutput(resolved.add(glow)));

  pipeline.outputColorTransform = false;
  pipeline.outputNode = painterly(display, depthTex, sceneNormal, camera, toggles);

  return { pipeline, toggles, gi, reflections };
}
