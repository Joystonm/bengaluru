import { useEffect } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { cameraBridge } from './cameraLink';

/**
 * Publishes the live camera and canvas size for DOM overlays that sit
 * outside the WebGL canvas (the landmark markers).
 */
export function CameraBridge() {
  const { camera, size, scene, gl } = useThree();

  useFrame(() => {
    cameraBridge.camera = camera;
    cameraBridge.width = size.width;
    cameraBridge.height = size.height;
  });

  // Handles on the scene for the diagnostics driver: without them there is
  // no way to ask the renderer what it is actually drawing.
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    const w = window as unknown as { __nbScene?: unknown; __nbCamera?: unknown };
    w.__nbScene = scene;
    w.__nbCamera = camera;
    (gl as unknown as { __scene?: unknown }).__scene = scene;
    (gl as unknown as { __camera?: unknown }).__camera = camera;
  }, [scene, camera, gl]);

  return null;
}
