/**
 * Timeline Editor
 * Canvas-based timeline with playhead, frame ruler, track rendering,
 * transport controls, and VFX marker editing.
 */

export interface TimelineTrack {
  type: 'animation' | 'vfx' | 'audio' | 'combat';
  name: string;
  clips: TimelineClip[];
  markers?: VFXMarker[];
}

export interface TimelineClip {
  startFrame: number;
  endFrame: number;
  name: string;
  color: string;
  data?: any;
}

export interface VFXMarker {
  frame: number;
  presetId: string;
  label: string;
  color: string;
  offset?: [number, number, number];
  rotation?: [number, number, number];
  scale?: number;
  followParent?: boolean;
}

export class Timeline {
  private panel: HTMLElement;
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private canvasWrap: HTMLElement;
  private tracksEl: HTMLElement;

  // State
  private currentFrame = 0;
  private totalFrames = 120;
  private fps = 30;
  playbackSpeed = 1.0; // public: segment speed multiplier
  private playing = false;
  private looping = true;
  private tracks: TimelineTrack[] = [];

  // Layout
  private trackHeight = 28;
  private rulerHeight = 20;
  private pixelsPerFrame = 4;

  // Drag
  private draggingPlayhead = false;
  private draggingMarker: { trackIdx: number; markerIdx: number } | null = null;
  private selectedMarker: { trackIdx: number; markerIdx: number } | null = null;

  // Callbacks
  onFrameChange: ((frame: number) => void) | null = null;
  onPlayStateChange: ((playing: boolean) => void) | null = null;
  onMarkerChanged: ((trackIdx: number, markers: VFXMarker[]) => void) | null = null;
  onMarkerSelected: ((marker: VFXMarker | null) => void) | null = null;
  onMarkerAdd: ((trackIdx: number, frame: number) => void) | null = null;

  // Refs
  private frameDisplay: HTMLElement;
  private totalDisplay: HTMLElement;
  private playBtn: HTMLElement;
  private loopBtn: HTMLElement;
  private animId: number | null = null;
  private lastTime = 0;

  constructor() {
    this.panel = document.getElementById('timeline-panel')!;
    this.canvas = document.getElementById('timeline-canvas') as HTMLCanvasElement;
    this.ctx = this.canvas.getContext('2d')!;
    this.canvasWrap = document.getElementById('timeline-canvas-wrap')!;
    this.tracksEl = document.getElementById('timeline-tracks')!;
    this.frameDisplay = document.getElementById('tl-current-frame')!;
    this.totalDisplay = document.getElementById('tl-total-frames')!;
    this.playBtn = document.getElementById('tl-btn-play')!;
    this.loopBtn = document.getElementById('tl-btn-loop')!;

    this.setupResizer();
    this.setupTransportButtons();
    this.setupCanvasEvents();
    this.resizeCanvas();

    // Initial render
    this.render();

    // Observe resize
    const resizeObserver = new ResizeObserver(() => this.resizeCanvas());
    resizeObserver.observe(this.canvasWrap);
  }

  // --- Public API ---

  setTotalFrames(frames: number) {
    this.totalFrames = Math.max(1, frames);
    this.totalDisplay.textContent = String(this.totalFrames);
    this.render();
  }

  setFPS(fps: number) {
    this.fps = fps;
  }

  setCurrentFrame(frame: number) {
    this.currentFrame = Math.max(0, Math.min(frame, this.totalFrames));
    this.frameDisplay.textContent = String(Math.round(this.currentFrame));
    this.render();
  }

  getCurrentFrame(): number { return Math.round(this.currentFrame); }
  getTotalFrames(): number { return this.totalFrames; }
  isPlaying(): boolean { return this.playing; }

  setTracks(tracks: TimelineTrack[]) {
    this.tracks = tracks;
    if (this.selectedMarker !== null) {
      this.selectedMarker = null;
      this.onMarkerSelected?.(null);
    }
    this.updateTrackLabels();
    this.render();
  }

  /** Add a VFX marker to a specific track */
  addMarker(trackIdx: number, marker: VFXMarker) {
    if (trackIdx < 0 || trackIdx >= this.tracks.length) return;
    if (!this.tracks[trackIdx].markers) this.tracks[trackIdx].markers = [];
    this.tracks[trackIdx].markers!.push(marker);
    this.onMarkerChanged?.(trackIdx, this.tracks[trackIdx].markers!);
    this.render();
  }

  /** Remove a VFX marker */
  removeMarker(trackIdx: number, markerIdx: number) {
    const track = this.tracks[trackIdx];
    if (!track?.markers) return;
    track.markers.splice(markerIdx, 1);
    this.selectedMarker = null;
    this.onMarkerChanged?.(trackIdx, track.markers);
    this.onMarkerSelected?.(null);
    this.render();
  }

  /** Update a marker's frame position */
  updateMarkerFrame(trackIdx: number, markerIdx: number, frame: number) {
    const track = this.tracks[trackIdx];
    if (!track?.markers?.[markerIdx]) return;
    track.markers[markerIdx].frame = Math.max(0, Math.min(this.totalFrames, frame));
    this.onMarkerChanged?.(trackIdx, track.markers);
    this.render();
  }

  /** Get markers for a track */
  getMarkers(trackIdx: number): VFXMarker[] {
    return this.tracks[trackIdx]?.markers || [];
  }

  getSelectedMarker(): VFXMarker | null {
    if (!this.selectedMarker) return null;
    const track = this.tracks[this.selectedMarker.trackIdx];
    return track?.markers?.[this.selectedMarker.markerIdx] || null;
  }

  play() {
    if (this.playing) return;
    this.playing = true;
    this.playBtn.textContent = '⏸';
    this.lastTime = performance.now();
    this.animId = requestAnimationFrame(this.tick);
    this.onPlayStateChange?.(true);
  }

  pause() {
    if (!this.playing) return;
    this.playing = false;
    this.playBtn.textContent = '▶';
    if (this.animId) cancelAnimationFrame(this.animId);
    this.animId = null;
    this.onPlayStateChange?.(false);
  }

  stop() {
    this.pause();
    this.setCurrentFrame(0);
    this.onFrameChange?.(0);
  }

  // --- Internal ---

  private tick = (time: number) => {
    if (!this.playing) return;
    const delta = (time - this.lastTime) / 1000;
    this.lastTime = time;

    this.currentFrame += delta * this.fps * this.playbackSpeed;

    if (this.currentFrame >= this.totalFrames) {
      if (this.looping) {
        this.currentFrame = 0;
      } else {
        this.currentFrame = this.totalFrames;
        this.pause();
      }
    }

    this.frameDisplay.textContent = String(Math.round(this.currentFrame));
    this.onFrameChange?.(Math.round(this.currentFrame));
    this.render();

    this.animId = requestAnimationFrame(this.tick);
  };

  private setupResizer() {
    const resizer = document.getElementById('timeline-resizer')!;
    let startY = 0;
    let startHeight = 0;

    const onMouseMove = (e: MouseEvent) => {
      const delta = startY - e.clientY;
      const newHeight = Math.max(80, Math.min(window.innerHeight * 0.5, startHeight + delta));
      this.panel.style.height = newHeight + 'px';
      window.dispatchEvent(new Event('resize'));
    };

    const onMouseUp = () => {
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };

    resizer.addEventListener('mousedown', (e) => {
      startY = e.clientY;
      startHeight = this.panel.offsetHeight;
      document.body.style.cursor = 'row-resize';
      document.body.style.userSelect = 'none';
      document.addEventListener('mousemove', onMouseMove);
      document.addEventListener('mouseup', onMouseUp);
    });
  }

  private setupTransportButtons() {
    document.getElementById('tl-btn-start')!.addEventListener('click', () => {
      this.setCurrentFrame(0);
      this.onFrameChange?.(0);
    });

    document.getElementById('tl-btn-prev')!.addEventListener('click', () => {
      this.setCurrentFrame(Math.max(0, this.getCurrentFrame() - 1));
      this.onFrameChange?.(this.getCurrentFrame());
    });

    this.playBtn.addEventListener('click', () => {
      if (this.playing) this.pause();
      else this.play();
    });

    document.getElementById('tl-btn-next')!.addEventListener('click', () => {
      this.setCurrentFrame(Math.min(this.totalFrames, this.getCurrentFrame() + 1));
      this.onFrameChange?.(this.getCurrentFrame());
    });

    document.getElementById('tl-btn-end')!.addEventListener('click', () => {
      this.setCurrentFrame(this.totalFrames);
      this.onFrameChange?.(this.getCurrentFrame());
    });

    this.loopBtn.addEventListener('click', () => {
      this.looping = !this.looping;
      this.loopBtn.classList.toggle('active', this.looping);
    });
    this.loopBtn.classList.add('active'); // Default loop on
  }

  private setupCanvasEvents() {
    this.canvas.addEventListener('mousedown', (e) => {
      const rect = this.canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;

      // Check if clicking on a marker first
      const markerHit = this.hitTestMarker(x, y);
      if (markerHit) {
        // Check for multiple markers at same frame position
        const track = this.tracks[markerHit.trackIdx];
        const hitFrame = track.markers![markerHit.markerIdx].frame;
        const sameFrameMarkers = track.markers!
          .map((m, idx) => ({ marker: m, idx }))
          .filter(({ marker }) => Math.abs(marker.frame - hitFrame) < 1);

        if (sameFrameMarkers.length > 1) {
          // Show popup menu for multi-marker selection
          this.showMarkerPopup(e, markerHit.trackIdx, sameFrameMarkers);
          return;
        }

        this.selectedMarker = markerHit;
        this.draggingMarker = markerHit;
        this.onMarkerSelected?.(this.tracks[markerHit.trackIdx].markers![markerHit.markerIdx]);
        this.render();
        return;
      }

      // Otherwise set playhead (keep marker selection intact)
      const frame = this.xToFrame(x);
      this.setCurrentFrame(frame);
      this.onFrameChange?.(this.getCurrentFrame());
      this.draggingPlayhead = true;
    });

    this.canvas.addEventListener('dblclick', (e) => {
      const rect = this.canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;

      // Double-click on VFX or Combat track → add new marker
      const trackIdx = this.yToTrackIndex(y);
      if (trackIdx >= 0 && trackIdx < this.tracks.length && (this.tracks[trackIdx].type === 'vfx' || this.tracks[trackIdx].type === 'combat')) {
        const frame = this.xToFrame(x);
        this.onMarkerAdd?.(trackIdx, frame);
      }
    });

    this.canvas.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      const rect = this.canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;

      // Right-click on marker → delete the currently SELECTED marker if at this position
      const markerHit = this.hitTestMarker(x, y);
      if (markerHit) {
        // If a marker is already selected and it's at this track, delete the selected one
        if (this.selectedMarker && this.selectedMarker.trackIdx === markerHit.trackIdx) {
          this.removeMarker(this.selectedMarker.trackIdx, this.selectedMarker.markerIdx);
        } else {
          this.removeMarker(markerHit.trackIdx, markerHit.markerIdx);
        }
      }
    });

    this.canvas.addEventListener('mousemove', (e) => {
      const rect = this.canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;

      if (this.draggingMarker) {
        const frame = this.xToFrame(x);
        this.updateMarkerFrame(this.draggingMarker.trackIdx, this.draggingMarker.markerIdx, frame);
        return;
      }

      if (this.draggingPlayhead) {
        const frame = this.xToFrame(x);
        this.setCurrentFrame(frame);
        this.onFrameChange?.(this.getCurrentFrame());
      }
    });

    window.addEventListener('mouseup', () => {
      this.draggingPlayhead = false;
      this.draggingMarker = null;
    });

    // Scroll to zoom
    this.canvasWrap.addEventListener('wheel', (e) => {
      e.preventDefault();
      if (e.ctrlKey) {
        const zoomFactor = e.deltaY > 0 ? 0.9 : 1.1;
        this.pixelsPerFrame = Math.max(1, Math.min(20, this.pixelsPerFrame * zoomFactor));
        this.resizeCanvas();
      }
      // Horizontal scroll is handled natively by the overflow-x: auto container
      this.render();
    }, { passive: false });
  }

  private resizeCanvas() {
    const wrapWidth = this.canvasWrap.clientWidth;
    const totalWidth = Math.max(wrapWidth, this.totalFrames * this.pixelsPerFrame + 40);
    const totalHeight = this.rulerHeight + this.tracks.length * this.trackHeight + this.trackHeight;

    this.canvas.width = totalWidth * window.devicePixelRatio;
    this.canvas.height = Math.max(totalHeight, this.canvasWrap.clientHeight) * window.devicePixelRatio;
    this.canvas.style.width = totalWidth + 'px';
    this.canvas.style.height = Math.max(totalHeight, this.canvasWrap.clientHeight) + 'px';
    this.ctx.scale(window.devicePixelRatio, window.devicePixelRatio);
    this.render();
  }

  private render() {
    const w = this.canvas.width / window.devicePixelRatio;
    const h = this.canvas.height / window.devicePixelRatio;
    const ctx = this.ctx;

    ctx.clearRect(0, 0, w, h);

    // Background
    ctx.fillStyle = '#11111b';
    ctx.fillRect(0, 0, w, h);

    // Ruler
    this.drawRuler(ctx, w);

    // Tracks
    this.drawTracks(ctx, w);

    // Playhead
    this.drawPlayhead(ctx, h);
  }

  private drawRuler(ctx: CanvasRenderingContext2D, width: number) {
    const y = 0;
    ctx.fillStyle = '#181825';
    ctx.fillRect(0, y, width, this.rulerHeight);

    ctx.strokeStyle = '#313244';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, this.rulerHeight);
    ctx.lineTo(width, this.rulerHeight);
    ctx.stroke();

    // Frame markers
    ctx.fillStyle = '#6c7086';
    ctx.font = '9px monospace';
    ctx.textAlign = 'center';

    const step = this.getTickStep();
    for (let f = 0; f <= this.totalFrames; f += step) {
      const x = this.frameToX(f);
      if (x < -10 || x > width + 10) continue;

      // Tick mark
      ctx.strokeStyle = '#45475a';
      ctx.beginPath();
      ctx.moveTo(x, this.rulerHeight - 6);
      ctx.lineTo(x, this.rulerHeight);
      ctx.stroke();

      // Label
      ctx.fillText(String(f), x, this.rulerHeight - 8);
    }

    // Minor ticks
    const minorStep = Math.max(1, Math.floor(step / 5));
    ctx.strokeStyle = '#313244';
    for (let f = 0; f <= this.totalFrames; f += minorStep) {
      const x = this.frameToX(f);
      if (x < 0 || x > width) continue;
      ctx.beginPath();
      ctx.moveTo(x, this.rulerHeight - 3);
      ctx.lineTo(x, this.rulerHeight);
      ctx.stroke();
    }
  }

  private drawTracks(ctx: CanvasRenderingContext2D, width: number) {
    const startY = this.rulerHeight;

    for (let i = 0; i < this.tracks.length; i++) {
      const track = this.tracks[i];
      const ty = startY + i * this.trackHeight;

      // Track background (alternating)
      ctx.fillStyle = i % 2 === 0 ? '#1e1e2e' : '#181825';
      ctx.fillRect(0, ty, width, this.trackHeight);

      // Track separator
      ctx.strokeStyle = '#1e1e2e';
      ctx.beginPath();
      ctx.moveTo(0, ty + this.trackHeight);
      ctx.lineTo(width, ty + this.trackHeight);
      ctx.stroke();

      // Draw clips
      for (const clip of track.clips) {
        const x1 = this.frameToX(clip.startFrame);
        const x2 = this.frameToX(clip.endFrame);
        const cw = Math.max(4, x2 - x1);

        ctx.fillStyle = clip.color;
        ctx.globalAlpha = 0.7;
        ctx.fillRect(x1, ty + 3, cw, this.trackHeight - 6);
        ctx.globalAlpha = 1;

        ctx.strokeStyle = clip.color;
        ctx.strokeRect(x1, ty + 3, cw, this.trackHeight - 6);

        if (cw > 30) {
          ctx.fillStyle = '#ffffff';
          ctx.font = '9px sans-serif';
          ctx.textAlign = 'left';
          ctx.fillText(clip.name, x1 + 4, ty + this.trackHeight / 2 + 3, cw - 8);
        }
      }

      // Draw VFX markers (diamond shapes)
      if (track.markers) {
        // Count markers at each frame for badge display
        const frameCounts = new Map<number, number>();
        for (const m of track.markers) {
          frameCounts.set(m.frame, (frameCounts.get(m.frame) || 0) + 1);
        }
        const drawnFrames = new Set<number>();

        for (let mi = 0; mi < track.markers.length; mi++) {
          const marker = track.markers[mi];
          const mx = this.frameToX(marker.frame);
          const my = ty + this.trackHeight / 2;
          const isSelected = this.selectedMarker?.trackIdx === i && this.selectedMarker?.markerIdx === mi;

          this.drawDiamond(ctx, mx, my, isSelected ? 8 : 6, marker.color, isSelected);

          // Badge count for stacked markers
          const count = frameCounts.get(marker.frame) || 1;
          if (count > 1 && !drawnFrames.has(marker.frame)) {
            drawnFrames.add(marker.frame);
            ctx.fillStyle = '#e64553';
            ctx.beginPath();
            ctx.arc(mx + 7, my - 7, 6, 0, Math.PI * 2);
            ctx.fill();
            ctx.fillStyle = '#fff';
            ctx.font = 'bold 8px sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText(String(count), mx + 7, my - 4);
          }

          // Label (show preset name)
          if (this.pixelsPerFrame > 2) {
            ctx.fillStyle = '#cdd6f4';
            ctx.font = '8px sans-serif';
            ctx.textAlign = 'left';
            ctx.fillText(marker.label, mx + 8, my + 3);
          }
        }
      }
    }
  }

  private drawDiamond(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, color: string, selected: boolean) {
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(x, y - size);
    ctx.lineTo(x + size, y);
    ctx.lineTo(x, y + size);
    ctx.lineTo(x - size, y);
    ctx.closePath();

    ctx.fillStyle = color;
    ctx.fill();

    if (selected) {
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 2;
      ctx.stroke();
    } else {
      ctx.strokeStyle = '#000000';
      ctx.lineWidth = 1;
      ctx.stroke();
    }
    ctx.restore();
  }

  private drawPlayhead(ctx: CanvasRenderingContext2D, height: number) {
    const x = this.frameToX(this.currentFrame);

    // Playhead line
    ctx.strokeStyle = '#89b4fa';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, height);
    ctx.stroke();
    ctx.lineWidth = 1;

    // Playhead top marker (triangle)
    ctx.fillStyle = '#89b4fa';
    ctx.beginPath();
    ctx.moveTo(x - 5, 0);
    ctx.lineTo(x + 5, 0);
    ctx.lineTo(x, 8);
    ctx.closePath();
    ctx.fill();
  }

  private frameToX(frame: number): number {
    return frame * this.pixelsPerFrame;
  }

  private xToFrame(x: number): number {
    return Math.max(0, Math.min(this.totalFrames, Math.round(x / this.pixelsPerFrame)));
  }

  private getTickStep(): number {
    // Choose tick spacing based on zoom level
    const minPixelSpacing = 50;
    const rawStep = minPixelSpacing / this.pixelsPerFrame;
    // Round to nice numbers
    const niceSteps = [1, 5, 10, 15, 30, 60, 100, 150, 300];
    for (const s of niceSteps) {
      if (s >= rawStep) return s;
    }
    return Math.ceil(rawStep / 100) * 100;
  }

  private updateTrackLabels() {
    this.tracksEl.innerHTML = '';
    for (const track of this.tracks) {
      const div = document.createElement('div');
      div.className = 'tl-track-label';
      const icon = track.type === 'animation' ? '🎬' : track.type === 'combat' ? '⚔️' : track.type === 'vfx' ? '💥' : '🔊';
      div.textContent = `${icon} ${track.name}`;
      this.tracksEl.appendChild(div);
    }
    if (this.tracks.length === 0) {
      for (const label of ['🎬 Animation', '💥 VFX', '🔊 Audio']) {
        const div = document.createElement('div');
        div.className = 'tl-track-label';
        div.textContent = label;
        this.tracksEl.appendChild(div);
      }
    }
  }

  private hitTestMarker(x: number, y: number): { trackIdx: number; markerIdx: number } | null {
    const startY = this.rulerHeight;
    for (let i = 0; i < this.tracks.length; i++) {
      const track = this.tracks[i];
      if (!track.markers) continue;
      const ty = startY + i * this.trackHeight;
      const my = ty + this.trackHeight / 2;

      for (let mi = 0; mi < track.markers.length; mi++) {
        const marker = track.markers[mi];
        const mx = this.frameToX(marker.frame);
        // Hit test: within 8px of diamond center
        if (Math.abs(x - mx) < 10 && Math.abs(y - my) < 10) {
          return { trackIdx: i, markerIdx: mi };
        }
      }
    }
    return null;
  }

  private showMarkerPopup(event: MouseEvent, trackIdx: number, items: { marker: VFXMarker; idx: number }[]) {
    // Remove existing popup
    this.hideMarkerPopup();

    const popup = document.createElement('div');
    popup.id = 'tl-marker-popup';
    popup.style.cssText = `
      position: absolute; z-index: 9999;
      left: ${event.clientX + 4}px; top: ${event.clientY - 4}px;
      background: #1e1e2e; border: 1px solid #313244; border-radius: 6px;
      padding: 4px 0; min-width: 140px; box-shadow: 0 4px 12px rgba(0,0,0,.4);
      font-family: inherit; font-size: 12px;
    `;

    for (const { marker, idx } of items) {
      const row = document.createElement('div');
      row.style.cssText = `
        padding: 6px 12px; cursor: pointer; color: #cdd6f4;
        display: flex; align-items: center; gap: 6px;
      `;
      row.innerHTML = `<span style="color:${marker.color};">◆</span> ${marker.label || marker.presetId}`;
      row.addEventListener('mouseenter', () => { row.style.background = '#313244'; });
      row.addEventListener('mouseleave', () => { row.style.background = 'none'; });
      row.addEventListener('click', () => {
        this.selectedMarker = { trackIdx, markerIdx: idx };
        this.onMarkerSelected?.(marker);
        this.render();
        this.hideMarkerPopup();
      });
      popup.appendChild(row);
    }

    document.body.appendChild(popup);

    // Close on outside click or Escape
    const closeHandler = (e: Event) => {
      if (e instanceof KeyboardEvent) {
        if (e.key === 'Escape') {
          this.hideMarkerPopup();
          document.removeEventListener('mousedown', closeHandler);
          document.removeEventListener('keydown', closeHandler);
        }
        return;
      }
      // MouseEvent: only close if click is OUTSIDE the popup
      if (e instanceof MouseEvent && popup.contains(e.target as Node)) return;
      this.hideMarkerPopup();
      document.removeEventListener('mousedown', closeHandler);
      document.removeEventListener('keydown', closeHandler);
    };
    setTimeout(() => {
      document.addEventListener('mousedown', closeHandler);
      document.addEventListener('keydown', closeHandler);
    }, 10);
  }

  private hideMarkerPopup() {
    const existing = document.getElementById('tl-marker-popup');
    if (existing) existing.remove();
  }

  private yToTrackIndex(y: number): number {
    const startY = this.rulerHeight;
    if (y < startY) return -1;
    return Math.floor((y - startY) / this.trackHeight);
  }
}
