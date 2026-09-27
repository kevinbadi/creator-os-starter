"use client";

import { cn } from "@/lib/utils";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { useMemo, useRef } from "react";

function FullscreenShader() {
  const materialRef = useRef<THREE.ShaderMaterial>(null!);
  const { size } = useThree();

  // Create a small static noise texture for iChannel0
  const noiseTexture = useMemo(() => {
    const w = 256;
    const h = 256;
    const data = new Uint8Array(w * h * 4);
    for (let i = 0; i < w * h * 4; i++) data[i] = Math.floor(Math.random() * 256);
    const tex = new THREE.DataTexture(data, w, h, THREE.RGBAFormat);
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.needsUpdate = true;
    return tex;
  }, []);

  const uniforms = useMemo(
    () => ({
      iTime: { value: 0 },
      iResolution: { value: new THREE.Vector2(size.width, size.height) },
      iChannel0: { value: noiseTexture },
    }),
    [noiseTexture, size.width, size.height]
  );

  useFrame(({ clock }) => {
    if (!materialRef.current) return;
    materialRef.current.uniforms.iTime.value = clock.getElapsedTime();
    materialRef.current.uniforms.iResolution.value.set(size.width, size.height);
  });

  return (
    <mesh>
      <planeGeometry args={[2, 2]} />
      <shaderMaterial
        ref={materialRef}
        depthWrite={false}
        depthTest={false}
        transparent={false}
        uniforms={uniforms}
        vertexShader={/* glsl */ `
          varying vec2 vUv;
          void main() {
            vUv = uv;
            gl_Position = vec4(position, 1.0);
          }
        `}
        fragmentShader={/* glsl */ `
          precision highp float;

          uniform float iTime;
          uniform vec2 iResolution;
          uniform sampler2D iChannel0;

          // "Starship" by @XorDev (adapted)
          vec4 O_color;

          void mainImage(out vec4 O, vec2 I)
          {
              vec2 r = iResolution.xy,
                   p = (I+I-r) / r.y * mat2(3.,4.,4.,-3.) / 1e2;

              vec4 S = vec4(0.0);
              vec4 C = vec4(1.,2.,3.,0.);
              vec4 W;

              for(float t=iTime, T=.1*t+p.y, i=0.; i<50.; i+=1.){
                  W = sin(i)*C;

                  // Creator OS palette: mostly silver streaks (cool shining
                  // silver <-> warm burning silver), occasional brand cyan.
                  float h = fract(sin(i*127.1)*43758.5453);
                  vec3 col = h < 0.15
                    ? vec3(0.10, 0.85, 1.00)
                    : mix(vec3(0.92, 0.96, 1.00), vec3(1.00, 0.94, 0.86), fract(h*7.0));

                  S += vec4(2.0*col, 0.0)
                       * exp(sin(i+i*T))
                       / length(max(p,
                         p / vec2(2.0, texture(iChannel0, p/exp(W.x)+vec2(i,t)/8.).r*40.0)
                       )) / 1e4;

                  p += .02 * cos(i*(C.xz+8.0+i) + T + T);
              }

              // Black background only: remove sky term (p.x*--C) but keep tanh tonemap
              O = vec4(tanh((S*S).rgb), 1.0);
          }

          void main() {
            vec2 fragCoord = gl_FragCoord.xy;
            vec4 O;
            mainImage(O, fragCoord);
            gl_FragColor = O;
          }
        `}
      />
    </mesh>
  );
}

export const Component = () => {
  return (
    <div className={cn("flex flex-col items-center gap-4 p-0 rounded-lg w-full h-full")}>
      <Canvas orthographic camera={{ position: [0, 0, 1], zoom: 1 }} dpr={[1, 2]}>
        {/* Ensure pure black background */}
        <color attach="background" args={["#000000"]} />
        <FullscreenShader />
      </Canvas>
    </div>
  );
};
