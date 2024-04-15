import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { createNoise2D } from 'simplex-noise';
import { VertexNormalsHelper } from 'three/addons/helpers/VertexNormalsHelper.js';
import { VRButton } from 'three/addons/webxr/VRButton.js';

async function main() {

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera( 75, window.innerWidth / window.innerHeight, 0.01, 1000 );

const renderer = new THREE.WebGLRenderer();
renderer.setSize( window.innerWidth, window.innerHeight );
document.body.appendChild(renderer.domElement);

document.body.appendChild(VRButton.createButton(renderer));
renderer.xr.enabled = true;

const controls = new OrbitControls( camera, renderer.domElement );

scene.add(new THREE.AxesHelper(1));

const geometry = new THREE.BoxGeometry( 1, 1, 1 );
const material = new THREE.MeshBasicMaterial( { color: 0x00ff00 } );

function fbm(noctaves) {
    var noise = [];
    for (var i = 0; i < noctaves; i++) {
        noise.push(createNoise2D());
    }
    const scale = Math.pow(2, noctaves);
    return function(x, y, z) {
        var output = 0.0;
        for (var i = 0; i < noctaves; i++) {
            output += (Math.pow(2, i) / (10 * scale)) *
                noise[i](scale*x/(1*Math.pow(2, i)),
                         scale*y/(1*Math.pow(2, i)));
        }
        return output;
    }
}

// Clamp heights to a minimum Z
function floor(minz) {
    return function(x, y, z) {
        if (z < minz) {
            return minz;
        } else {
            return z;
        }
    }
}

// Scale heights by a constant factor
function scale(s) {
    return function (x, y, z) {
        return s * z;
    }
}

// Add/Sub to heights with a constant offset
function offset(o) {
    return function (x, y, z) {
        return z + o;
    }
}

function apply_heightmap_transform(geometry, transform) {
    // Applies functions of the form (x, y, z) => new_z to the passed heightmap.
    var pos_attr = geometry.getAttribute('position');
    for (var i = 0; i < pos_attr.array.length/3; i++) {
        var x = pos_attr.array[3*i];
        var y = pos_attr.array[3*i + 1];
        var z = pos_attr.array[3*i + 2];
        pos_attr.array[3*i + 2] = transform(x, y, z);
    }
}

async function heightmap_transform_from_json_url(url) {
    // Loads a heightmap from a json loader endpoint and returns it as a geometry.
    return await fetch(url)
        .then(res => res.json())
        .then(json => {
            const xdim = json['dims']['x'];
            const ydim = json['dims']['y'];
            const hmap = json['heights'];

            console.log("Loaded %d x %d map", xdim, ydim);

            return function transform(x, y, z) {
                // Transform from [N, N] to (0, dim)
                const N = 1;
                x = Math.round(xdim * 0.5 * (x / N + 1))
                y = Math.round(xdim * 0.5 * (y / N + 1))

                if ((0 <= x && x < xdim) && (0 <= y && y < ydim)) {
                    return hmap[y][x] / (1 << 16);
                } else {
                    console.log(`Out of bounds transfrom at (${x}, ${y}): Returning height of 0.`)
                    return 0.
                }
            }
        });
}

const resolution = 1024;

const N = 1
var planegeo = new THREE.PlaneGeometry(N, N, resolution, resolution);
var heightmap = await heightmap_transform_from_json_url("height.json");

// var noise = fbm(5);
// apply_heightmap_transform(planegeo, noise);
apply_heightmap_transform(planegeo, heightmap);
apply_heightmap_transform(planegeo, scale(0.25));
apply_heightmap_transform(planegeo, offset(-0.10));
apply_heightmap_transform(planegeo, floor(0));

planegeo.computeVertexNormals();

////////////////
// Erosion stuff
const Particle = class {
    constructor(x, y) {
        this.x = x;
        this.y = y;
        this.dx = 0.0;
        this.dy = 0.0;
        this.volume = 1.0;
        this.sediment = 0.0;
    }
};

const dt = 1.0;
const density = 1.0;
const friction = 1.0;
const evaporationRate = 1e-3;
const depositionRate = 1e-3;
const normals = planegeo.getAttribute('normal').array;
const positions = planegeo.getAttribute('position').array;
console.log(positions);

console.log(normals.length, positions.length);
for (var i = 0; i < 1000; i++) {
    var x = Math.round((resolution + 1) * Math.random);
    var y = Math.round((resolution + 1) * Math.random);
    var particle = new Particle(x, y);

    const offset = (resolution + 1) * x + y;
    const nx = normals[3 * offset];
    const ny = normals[3 * offset + 1];
    const nz = normals[3 * offset + 2];
    particle.dx += dt * nx / (particle.volume * density);
    particle.dy += dt * ny / (particle.volume * density);
    particle.x += dt * particle.dx;
    particle.y += dt * particle.dy;
    particle.dx *= (1 - dt * friction);
    particle.dy *= (1 - dt * friction);

    const offset2 = (resolution + 1) * Math.round(particle.x) + Math.round(particle.y);
    const c_eq = particle.volume * Math.sqrt(particle.dx * particle.dx + particle.dy * particle.dy) *
                    (positions[offset + 2] - positions[offset2 + 2]);
    if (c_eq < 0.0) {
        c_eq = 0.0;
    }

    const cdiff = c_eq - particle.sediment;
    particle.sediment += dt * depositionRate * cdiff;
    planegeo.getAttribute('position').array[offset + 2] -= dt * particle.volume * depositionRate * cdiff;

    particle.volume *= (1 - dt * evaporationRate);
}
////////////////

const light = new THREE.HemisphereLight(0xffffff, 0x080820, 1);
scene.add(light);

const planemat = new THREE.MeshPhysicalMaterial( {color: 0xffffff, side: THREE.DoubleSide} );
// planemat.wireframe = true;
const plane = new THREE.Mesh( planegeo, planemat );
plane.rotation.x = -Math.PI / 2;

const norm_helper = new VertexNormalsHelper( plane, 0.1, 0xff0000 );

scene.add( plane );
//scene.add( norm_helper );

camera.position.z = 1;

// Need animation loop for XR
renderer.setAnimationLoop(function () {
    renderer.render(scene, camera);
    controls.update();
});

}

main()