const root = document.documentElement;
const particleCanvas = document.getElementById("particleCanvas");
const ctx = particleCanvas.getContext("2d");
const sceneMotion = document.getElementById("sceneMotion");
const sceneFrame = document.getElementById("sceneFrame");
const giantWord = document.getElementById("giantWord");
const bootScreen = document.getElementById("bootScreen");

let width = 0;
let height = 0;
let particles = [];
let targetX = 0.5;
let targetY = 0.45;
let pointerX = 0.5;
let pointerY = 0.45;

function resizeCanvas() {
  const dpr = Math.min(window.devicePixelRatio || 1, 1.75);
  width = window.innerWidth;
  height = window.innerHeight;
  particleCanvas.width = Math.floor(width * dpr);
  particleCanvas.height = Math.floor(height * dpr);
  particleCanvas.style.width = `${width}px`;
  particleCanvas.style.height = `${height}px`;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  const count = Math.min(110, Math.max(44, Math.floor(width / 16)));
  particles = Array.from({ length: count }, (_, index) => ({
    x: (index / count) * width + Math.random() * 90,
    y: Math.random() * height,
    speed: 0.22 + Math.random() * 0.88,
    length: 42 + Math.random() * 120,
    alpha: 0.12 + Math.random() * 0.34,
  }));
}

function renderParticles() {
  ctx.clearRect(0, 0, width, height);
  const driftX = (pointerX - 0.5) * 24;
  const driftY = (pointerY - 0.5) * 18;

  particles.forEach((particle) => {
    particle.y += particle.speed;
    particle.x += Math.sin((particle.y + particle.length) * 0.006) * 0.18;

    if (particle.y - particle.length > height) {
      particle.y = -particle.length;
      particle.x = Math.random() * width;
    }

    const gradient = ctx.createLinearGradient(
      particle.x + driftX,
      particle.y + driftY - particle.length,
      particle.x + driftX,
      particle.y + driftY,
    );
    gradient.addColorStop(0, "rgba(126, 214, 255, 0)");
    gradient.addColorStop(0.5, `rgba(126, 214, 255, ${particle.alpha})`);
    gradient.addColorStop(1, "rgba(126, 214, 255, 0)");

    ctx.strokeStyle = gradient;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(particle.x + driftX, particle.y + driftY - particle.length);
    ctx.lineTo(particle.x + driftX, particle.y + driftY);
    ctx.stroke();
  });

  requestAnimationFrame(renderParticles);
}

function updatePointer(event) {
  targetX = event.clientX / window.innerWidth;
  targetY = event.clientY / window.innerHeight;
}

function animatePointer() {
  pointerX += (targetX - pointerX) * 0.12;
  pointerY += (targetY - pointerY) * 0.12;

  const tiltY = (pointerX - 0.5) * 5.2;
  const tiltX = (0.5 - pointerY) * 4.2;

  root.style.setProperty("--mx", `${pointerX * 100}%`);
  root.style.setProperty("--my", `${pointerY * 100}%`);
  root.style.setProperty("--tilt-x", `${tiltX.toFixed(2)}deg`);
  root.style.setProperty("--tilt-y", `${tiltY.toFixed(2)}deg`);

  requestAnimationFrame(animatePointer);
}

function bootSequence() {
  const tl = gsap.timeline({ defaults: { ease: "power3.out" } });
  tl.to(".boot-logo", { opacity: 1, scale: 1, duration: 0.85 })
    .to(".boot-scan", { x: "115%", duration: 0.95 }, "-=0.35")
    .to(
      ".boot-logo",
      { filter: "invert(1) drop-shadow(0 0 48px rgba(125, 215, 255, 0.72))", duration: 0.42 },
      "-=0.28",
    )
    .to(bootScreen, {
      opacity: 0,
      duration: 0.85,
      delay: 0.18,
      onComplete: () => bootScreen.remove(),
    });
}

function setupScrollAnimation() {
  gsap.registerPlugin(ScrollTrigger);

  gsap.fromTo(
    sceneMotion,
    { scale: 1.08, y: 48, opacity: 1, filter: "brightness(1)" },
    {
      scale: 1.46,
      y: -280,
      opacity: 0.28,
      filter: "brightness(1.04)",
      ease: "none",
      scrollTrigger: {
        trigger: ".hero",
        start: "top top",
        end: "bottom top",
        scrub: true,
      },
    },
  );

  gsap.to(giantWord, {
    y: -160,
    opacity: 0.2,
    ease: "none",
    scrollTrigger: {
      trigger: "main",
      start: "top top",
      end: "bottom bottom",
      scrub: true,
    },
  });

  gsap.utils.toArray(".scroll-panel").forEach((panel) => {
    const layers = panel.querySelectorAll(".parallax-layer");
    layers.forEach((layer) => {
      const depth = Number(layer.dataset.depth || 0.12);
      gsap.to(layer, {
        y: () => -window.innerHeight * depth,
        ease: "none",
        scrollTrigger: {
          trigger: panel,
          start: "top bottom",
          end: "bottom top",
          scrub: true,
        },
      });
    });
  });

  gsap.utils.toArray(".reveal").forEach((item) => {
    gsap.to(item, {
      opacity: 1,
      y: 0,
      duration: 0.8,
      ease: "power2.out",
      scrollTrigger: {
        trigger: item,
        start: "top 78%",
        toggleActions: "play none none reverse",
      },
    });
  });

  gsap.fromTo(
    ".signal-stack span",
    { scaleX: 0.12, opacity: 0.08 },
    {
      scaleX: 1,
      opacity: 1,
      stagger: 0.08,
      ease: "none",
      scrollTrigger: {
        trigger: ".intro-section",
        start: "top 72%",
        end: "center 34%",
        scrub: true,
      },
    },
  );

  gsap.fromTo(
    ".flow-rail span",
    { xPercent: -30, opacity: 0.18 },
    {
      xPercent: 26,
      opacity: 0.9,
      stagger: 0.12,
      ease: "none",
      scrollTrigger: {
        trigger: ".flow-section",
        start: "top bottom",
        end: "bottom top",
        scrub: true,
      },
    },
  );
}

window.addEventListener("resize", resizeCanvas);
window.addEventListener("pointermove", updatePointer);

resizeCanvas();
renderParticles();
animatePointer();
bootSequence();
setupScrollAnimation();
