import WindowManager from './WindowManager.js'

const t = THREE;
let camera, scene, renderer, world;
let near, far;
let pixR = window.devicePixelRatio ? window.devicePixelRatio : 1;
let particleSystems = [];
let sceneOffsetTarget = {x: 0, y: 0};
let sceneOffset = {x: 0, y: 0};

let today = new Date();
today.setHours(0);
today.setMinutes(0);
today.setSeconds(0);
today.setMilliseconds(0);
today = today.getTime();

let internalTime = getTime();
let windowManager;
let initialized = false;

// get time in seconds since beginning of the day (so that all windows use the same time)
function getTime ()
{
	return (new Date().getTime() - today) / 1000.0;
}

// Create particle system for cosmic swirl effect
function createParticleSystem(windowIndex, centerX, centerY) {
    const particleCount = 2000;
    const geometry = new t.BufferGeometry();
    const positions = new Float32Array(particleCount * 3);
    const velocities = new Float32Array(particleCount * 3);
    const ages = new Float32Array(particleCount);
    const opacities = new Float32Array(particleCount);
    
    // Initialize particles in spiral pattern
    for (let i = 0; i < particleCount; i++) {
        const angle = (i / particleCount) * Math.PI * 8; // Multiple spirals
        const radius = (i / particleCount) * 200;
        const spiralX = Math.cos(angle) * radius;
        const spiralY = Math.sin(angle) * radius;
        
        positions[i * 3] = centerX + spiralX;
        positions[i * 3 + 1] = centerY + spiralY;
        positions[i * 3 + 2] = 0;
        
        // Set initial velocities for flowing motion
        velocities[i * 3] = Math.cos(angle + Math.PI/2) * 2;
        velocities[i * 3 + 1] = Math.sin(angle + Math.PI/2) * 2;
        velocities[i * 3 + 2] = 0;
        
        ages[i] = Math.random();
        opacities[i] = Math.random() * 0.8 + 0.2;
    }
    
    geometry.setAttribute('position', new t.BufferAttribute(positions, 3));
    geometry.setAttribute('velocity', new t.BufferAttribute(velocities, 3));
    geometry.setAttribute('age', new t.BufferAttribute(ages, 1));
    geometry.setAttribute('opacity', new t.BufferAttribute(opacities, 1));
    
    // Create glowing material
    const material = new t.ShaderMaterial({
        uniforms: {
            time: { value: 0 },
            windowIndex: { value: windowIndex }
        },
        vertexShader: `
            attribute float age;
            attribute float opacity;
            attribute vec3 velocity;
            uniform float time;
            uniform float windowIndex;
            varying float vOpacity;
            varying float vAge;
            
            void main() {
                vOpacity = opacity;
                vAge = age;
                
                vec3 pos = position;
                
                // Add spiral motion
                float spiralTime = time * 0.5 + windowIndex * 0.3;
                float radius = length(pos.xy);
                float angle = atan(pos.y, pos.x) + spiralTime * 0.002 * (1.0 + radius * 0.01);
                
                pos.x = cos(angle) * radius;
                pos.y = sin(angle) * radius;
                
                // Add flowing motion
                pos += velocity * sin(time * 0.001 + age * 6.28) * 10.0;
                
                // Add some vertical drift
                pos.y += sin(time * 0.0005 + age * 3.14) * 20.0;
                
                gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
                gl_PointSize = 2.0 + sin(time * 0.01 + age * 10.0) * 1.0;
            }
        `,
        fragmentShader: `
            varying float vOpacity;
            varying float vAge;
            uniform float time;
            
            void main() {
                // Create circular particle
                vec2 center = gl_PointCoord - 0.5;
                float dist = length(center);
                if (dist > 0.5) discard;
                
                // Create glow effect
                float alpha = (1.0 - dist * 2.0) * vOpacity;
                alpha *= 0.6 + 0.4 * sin(time * 0.01 + vAge * 6.28);
                
                // Green cosmic color with some variation
                vec3 color = vec3(0.1, 0.8 + sin(vAge * 3.14) * 0.2, 0.3);
                color *= 1.5; // Brighten for glow effect
                
                gl_FragColor = vec4(color, alpha);
            }
        `,
        transparent: true,
        blending: t.AdditiveBlending,
        depthWrite: false
    });
    
    const points = new t.Points(geometry, material);
    return points;
}

if (new URLSearchParams(window.location.search).get("clear"))
{
	localStorage.clear();
}
else
{	
	// this code is essential to circumvent that some browsers preload the content of some pages before you actually hit the url
	document.addEventListener("visibilitychange", () => 
	{
		if (document.visibilityState != 'hidden' && !initialized)
		{
			init();
		}
	});

	window.onload = () => {
		if (document.visibilityState != 'hidden')
		{
			init();
		}
	};

	function init ()
	{
		initialized = true;

		// add a short timeout because window.offsetX reports wrong values before a short period 
		setTimeout(() => {
			setupScene();
			setupWindowManager();
			resize();
			updateWindowShape(false);
			render();
			window.addEventListener('resize', resize);
		}, 500)	
	}

	function setupScene ()
	{
		camera = new t.OrthographicCamera(0, 0, window.innerWidth, window.innerHeight, -10000, 10000);
		
		camera.position.z = 2.5;
		near = camera.position.z - .5;
		far = camera.position.z + 0.5;

		scene = new t.Scene();
		scene.background = new t.Color(0.0);
		scene.add( camera );

		renderer = new t.WebGLRenderer({antialias: true, depthBuffer: true});
		renderer.setPixelRatio(pixR);
	    
	  	world = new t.Object3D();
		scene.add(world);

		renderer.domElement.setAttribute("id", "scene");
		document.body.appendChild( renderer.domElement );
	}

	function setupWindowManager ()
	{
		windowManager = new WindowManager();
		windowManager.setWinShapeChangeCallback(updateWindowShape);
		windowManager.setWinChangeCallback(windowsUpdated);

		// here you can add your custom metadata to each windows instance
		let metaData = {foo: "bar"};

		// this will init the windowmanager and add this window to the centralised pool of windows
		windowManager.init(metaData);

		// call update windows initially (it will later be called by the win change callback)
		windowsUpdated();
	}

	function windowsUpdated ()
	{
		updateParticleSystems();
	}

	function updateParticleSystems ()
	{
		let wins = windowManager.getWindows();

		// remove all particle systems
		particleSystems.forEach((ps) => {
			world.remove(ps);
		})

		particleSystems = [];

		// add new particle systems based on the current window setup
		for (let i = 0; i < wins.length; i++)
		{
			let win = wins[i];
			let centerX = win.shape.x + (win.shape.w * .5);
			let centerY = win.shape.y + (win.shape.h * .5);
			
			let particleSystem = createParticleSystem(i, centerX, centerY);
			world.add(particleSystem);
			particleSystems.push(particleSystem);
		}
	}

	function updateWindowShape (easing = true)
	{
		// storing the actual offset in a proxy that we update against in the render function
		sceneOffsetTarget = {x: -window.screenX, y: -window.screenY};
		if (!easing) sceneOffset = sceneOffsetTarget;
	}

	function render ()
	{
		let t = getTime();

		windowManager.update();

		// calculate the new position based on the delta between current offset and new offset times a falloff value (to create the nice smoothing effect)
		let falloff = .05;
		sceneOffset.x = sceneOffset.x + ((sceneOffsetTarget.x - sceneOffset.x) * falloff);
		sceneOffset.y = sceneOffset.y + ((sceneOffsetTarget.y - sceneOffset.y) * falloff);

		// set the world position to the offset
		world.position.x = sceneOffset.x;
		world.position.y = sceneOffset.y;

		let wins = windowManager.getWindows();

		// loop through all our particle systems and update their positions and time
		for (let i = 0; i < particleSystems.length; i++)
		{
			let particleSystem = particleSystems[i];
			let win = wins[i];

			let posTarget = {x: win.shape.x + (win.shape.w * .5), y: win.shape.y + (win.shape.h * .5)};

			particleSystem.position.x = particleSystem.position.x + (posTarget.x - particleSystem.position.x) * falloff;
			particleSystem.position.y = particleSystem.position.y + (posTarget.y - particleSystem.position.y) * falloff;
			
			// Update shader time uniform
			particleSystem.material.uniforms.time.value = t;
		}

		renderer.render(scene, camera);
		requestAnimationFrame(render);
	}

	// resize the renderer to fit the window size
	function resize ()
	{
		let width = window.innerWidth;
		let height = window.innerHeight
		
		camera = new t.OrthographicCamera(0, width, 0, height, -10000, 10000);
		camera.updateProjectionMatrix();
		renderer.setSize( width, height );
	}
}
