import { Component, ElementRef, effect, inject, untracked, viewChild } from '@angular/core';

import { CelebrationIntensity, CelebrationService } from '../../../core/services/celebration.service';

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  rotation: number;
  spin: number;
  color: string;
  life: number;
}

const COLORS = ['#ff7b59', '#ffd166', '#06d6a0', '#4f7cff', '#ef476f', '#9b5de5', '#ffffff'];
const GRAVITY = 0.28;
const DRAG = 0.992;

@Component({
  selector: 'app-confetti-overlay',
  template: '<canvas #canvas class="confetti-canvas" aria-hidden="true"></canvas>',
  styleUrl: './confetti-overlay.scss',
})
export class ConfettiOverlay {
  private readonly celebration = inject(CelebrationService);
  private readonly canvasRef = viewChild.required<ElementRef<HTMLCanvasElement>>('canvas');
  private particles: Particle[] = [];
  private rafId = 0;
  private readonly reducedMotion =
    typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

  constructor() {
    effect(() => {
      const request = this.celebration.request();

      if (!request) {
        return;
      }

      untracked(() => this.launch(request.intensity));
    });
  }

  private launch(intensity: CelebrationIntensity) {
    // Honor reduced-motion preferences by skipping the animation entirely.
    if (this.reducedMotion) {
      console.log('[celebration] overlay skipped: prefers-reduced-motion is ON');
      return;
    }

    const canvas = this.canvasRef().nativeElement;
    const context = canvas.getContext('2d');

    if (!context) {
      console.log('[celebration] overlay skipped: no 2d canvas context');
      return;
    }

    this.sizeCanvas(canvas);

    const width = canvas.width / (window.devicePixelRatio || 1);
    const count = intensity === 'big' ? 150 : 60;
    console.log('[celebration] launching', count, 'particles; canvas', canvas.width, 'x', canvas.height);

    for (let index = 0; index < count; index += 1) {
      this.particles.push(this.spawnParticle(intensity, width));
    }

    if (!this.rafId) {
      this.rafId = requestAnimationFrame(() => this.tick(context, canvas));
    }
  }

  private spawnParticle(intensity: CelebrationIntensity, width: number): Particle {
    const fromTop = intensity === 'big';
    const originX = fromTop ? Math.random() * width : width / 2 + (Math.random() - 0.5) * width * 0.3;
    const originY = fromTop ? -20 - Math.random() * 40 : window.innerHeight * 0.4;

    return {
      x: originX,
      y: originY,
      vx: (Math.random() - 0.5) * (fromTop ? 6 : 9),
      vy: fromTop ? Math.random() * 3 + 2 : -(Math.random() * 11 + 6),
      size: Math.random() * 7 + 5,
      rotation: Math.random() * Math.PI,
      spin: (Math.random() - 0.5) * 0.3,
      color: COLORS[Math.floor(Math.random() * COLORS.length)],
      life: 1,
    };
  }

  private tick(context: CanvasRenderingContext2D, canvas: HTMLCanvasElement) {
    const ratio = window.devicePixelRatio || 1;
    const height = canvas.height / ratio;

    context.clearRect(0, 0, canvas.width, canvas.height);

    this.particles = this.particles.filter((particle) => {
      particle.vx *= DRAG;
      particle.vy = particle.vy * DRAG + GRAVITY;
      particle.x += particle.vx;
      particle.y += particle.vy;
      particle.rotation += particle.spin;

      // Begin fading once the particle has fallen past the lower third of the viewport.
      if (particle.y > height * 0.7) {
        particle.life -= 0.02;
      }

      if (particle.life <= 0 || particle.y > height + 40) {
        return false;
      }

      context.save();
      context.globalAlpha = Math.max(0, particle.life);
      context.translate(particle.x * ratio, particle.y * ratio);
      context.rotate(particle.rotation);
      context.fillStyle = particle.color;
      context.fillRect((-particle.size / 2) * ratio, (-particle.size / 2) * ratio, particle.size * ratio, particle.size * 0.6 * ratio);
      context.restore();

      return true;
    });

    if (this.particles.length > 0) {
      this.rafId = requestAnimationFrame(() => this.tick(context, canvas));
    } else {
      context.clearRect(0, 0, canvas.width, canvas.height);
      this.rafId = 0;
    }
  }

  private sizeCanvas(canvas: HTMLCanvasElement) {
    const ratio = window.devicePixelRatio || 1;
    canvas.width = window.innerWidth * ratio;
    canvas.height = window.innerHeight * ratio;
  }
}
