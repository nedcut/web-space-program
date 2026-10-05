import * as THREE from 'three';
import type { BodyDef } from '../../sim/bodies/types';
import type { Terrain } from '../../sim/terrain';
import { latLonToUnit } from '../../sim/terrain';
import { LANDMARKS, landmarkPosition } from '../../sim/terrain/landmarks';

/** Small local meshes: float64 placement before upload, no solar-system float32 positions. */
export class SurfaceFeatures {
  readonly group = new THREE.Group();
  private entries: { mesh: THREE.Group; position: THREE.Vector3; dust?: boolean }[] = [];
  private materials: THREE.Material[] = [];
  private time = { value: 0 };
  private sun = { value: new THREE.Vector3(1,0,0) };
  private surfaceMaterial(color: number): THREE.ShaderMaterial {
    const material = new THREE.ShaderMaterial({
      uniforms: { color: {value: new THREE.Color(color)}, sun: this.sun },
      vertexShader: `#include <common>
        #include <logdepthbuf_pars_vertex>
        varying vec3 n; varying vec3 p;
        void main(){ n=mat3(modelMatrix)*normal; p=position; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);
        #include <logdepthbuf_vertex>
        }`,
      fragmentShader: `#include <common>
        #include <logdepthbuf_pars_fragment>
        uniform vec3 color; uniform vec3 sun; varying vec3 n; varying vec3 p;
        void main(){
        #include <logdepthbuf_fragment>
        float strata=0.9+0.1*sin(p.y*2.0+p.x*0.2);
        gl_FragColor=vec4(color*strata*(0.08+max(dot(normalize(n),sun),0.0)*1.4),1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        }`,
    });
    this.materials.push(material); return material;
  }
  constructor(body: BodyDef, terrain: Terrain) {
    const rock = this.surfaceMaterial(body.id === 'mars' ? 0x995e38 : 0x89949b);
    const metal = this.surfaceMaterial(0xc6aa6b);

    const add = (group: THREE.Group, position: THREE.Vector3, dust = false) => {
      group.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0), position.clone().normalize());
      this.entries.push({ mesh: group, position, dust }); this.group.add(group);
    };
    for (const l of LANDMARKS.filter(l => l.body === body.id)) {
      const group = new THREE.Group();
      const p = landmarkPosition(body, terrain, l);
      const box = (x: number,y: number,z: number,px: number,py: number,pz: number,mat = rock) => {
        const m = new THREE.Mesh(new THREE.BoxGeometry(x,y,z), mat); m.position.set(px,py,pz); group.add(m);
      };
      if (l.kind === 'arch') {
        const geometry = new THREE.TorusGeometry(18,5,7,28,Math.PI);
        const points = geometry.attributes.position;
        for (let i=0;i<points.count;i++) {
          const x=points.getX(i), y=points.getY(i), z=points.getZ(i);
          const erosion = Math.sin(x*0.7+y*1.3+z*0.8)*0.65 + Math.sin(x*1.9-z)*0.35;
          points.setXYZ(i,x+erosion*0.6,y+erosion,z+erosion*0.5);
        }
        geometry.computeVertexNormals();
        const arch = new THREE.Mesh(geometry,rock);
        arch.position.y = 2; group.add(arch);
        for (const x of [-18,18]) {
          const foot = new THREE.Mesh(new THREE.DodecahedronGeometry(8,0),rock);
          foot.position.set(x,-2,0); group.add(foot);
        }
      } else if (l.kind === 'probe') {
        box(2,1.5,2,0,1,0,metal); box(0.12,5,0.12,0,3,0,metal);
        for (const x of [-1,1]) box(1,0.3,5,x*2,0.2,0,metal);
        const dish = new THREE.Mesh(new THREE.ConeGeometry(1.4,0.45,16,1,true),metal); dish.position.y=5.5; group.add(dish);
      } else if (l.kind === 'airfield') {
        const asphalt = this.surfaceMaterial(0x30383a);
        box(28,0.2,450,0,0.1,0,asphalt);
        for (let z=-190;z<200;z+=30) box(1,0.05,12,0,0.23,z,metal);
        box(3,14,3,32,7,-150,metal);
      } else {
        for (let i=0;i<5;i++) {
          const m=new THREE.Mesh(new THREE.DodecahedronGeometry(8-i,0),rock);
          m.position.set(Math.sin(i*5)*7,i*4,Math.cos(i*5)*4); m.rotation.set(i,0,i*0.3); group.add(m);
        }
      }
      add(group,new THREE.Vector3(p.x,p.y,p.z));
    }
    if (body.id === 'io') {
      for (const [lat,lon] of [[18,30],[-26,-75],[42,130]]) {
        const d=latLonToUnit(lat,lon), radius=body.radius*0.018;
        const group=new THREE.Group();
        const geometry=new THREE.CircleGeometry(radius,80);
        geometry.rotateX(-Math.PI/2);
        const pos=geometry.attributes.position;
        // Spherical liquid surface within a named, flattened caldera.
        for(let i=0;i<pos.count;i++) pos.setY(i, -(pos.getX(i)**2+pos.getZ(i)**2)/(2*body.radius));
        geometry.computeVertexNormals();
        const mat=new THREE.ShaderMaterial({
          uniforms: { time: this.time, radius: { value: radius } },
          vertexShader: `#include <common>
            #include <logdepthbuf_pars_vertex>
            varying vec3 p;
            void main(){p=position;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);
            #include <logdepthbuf_vertex>
            }`,
          fragmentShader: `#include <common>
            #include <logdepthbuf_pars_fragment>
            uniform float time; uniform float radius; varying vec3 p;
            vec2 hash(vec2 v){return fract(sin(vec2(dot(v,vec2(127.1,311.7)),dot(v,vec2(269.5,183.3))))*43758.5453);}
            void main(){
            #include <logdepthbuf_fragment>
            float angle=atan(p.z,p.x);
            if(length(p.xz)/radius > 0.92+0.035*sin(angle*7.0)+0.025*sin(angle*13.0)) discard;
            vec2 q=p.xz*0.006;
            q+=vec2(sin(q.y*0.73),cos(q.x*0.61))*0.4;
            vec2 cell=floor(q), f=fract(q);
            float first=10.0, second=10.0;
            for(int x=-1;x<=1;x++) for(int y=-1;y<=1;y++) {
              vec2 offset=vec2(float(x),float(y));
              float d=length(offset+hash(cell+offset)-f);
              if(d<first){second=first;first=d;}else{second=min(second,d);}
            }
            float glow=1.0-smoothstep(0.015,0.075,second-first);
            float pulse=0.85+0.15*sin(time*0.6+q.x);
            gl_FragColor=vec4(mix(vec3(0.022,0.007,0.004),vec3(3.5,0.4,0.015)*pulse,glow),1.0);
            #include <tonemapping_fragment>
            #include <colorspace_fragment>
            }`,
        }); this.materials.push(mat);
        group.add(new THREE.Mesh(geometry,mat));
        add(group,new THREE.Vector3(d.x,d.y,d.z).multiplyScalar(body.radius-body.surface!.relief*0.16+2));
      }
    }
    if (body.id === 'mars') {
      for (const [lat,lon] of [[-9,-48],[12,25],[-22,85]]) {
        const d=latLonToUnit(lat,lon), group=new THREE.Group();
        const mat=new THREE.MeshBasicMaterial({color:0xb17b52,transparent:true,opacity:0.16,depthWrite:false,side:THREE.DoubleSide}); this.materials.push(mat);
        for(let i=0;i<5;i++) {
          const m=new THREE.Mesh(new THREE.CylinderGeometry(10+i*4,2,100,14,1,true),mat); m.position.set(Math.sin(i)*4,50,Math.cos(i)*4); group.add(m);
        }
        add(group,new THREE.Vector3(d.x,d.y,d.z).multiplyScalar(body.radius+terrain.heightAt(d.x,d.y,d.z)),true);
      }
    }
  }
  update(offset: THREE.Vector3, rotation: THREE.Quaternion, camera: THREE.Vector3, time: number, sun: THREE.Vector3) {
    this.sun.value.copy(sun);
    this.time.value = time;
    for(const e of this.entries) {
      e.mesh.position.copy(e.position).applyQuaternion(rotation).add(offset);
      e.mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0),e.position.clone().normalize()).premultiply(rotation);
      e.mesh.visible=e.mesh.position.distanceTo(camera)<100000;
      if(e.dust) { e.mesh.visible &&= Math.sin(time/45)>0.35; e.mesh.rotateY(time*0.5); }
    }
  }
  dispose() { for(const m of this.materials) m.dispose(); }
}
