import { KazagumoTrack } from './KazagumoTrack';
import { KazagumoError } from '../../Modules/Interfaces';

export class KazagumoQueue extends Array<KazagumoTrack> {
  /** Get the size of queue */
  public get size() {
    return this.length;
  }

  /** Get the size of queue including current */
  public get totalSize(): number {
    return this.length + (this.current ? 1 : 0);
  }

  /** Check if the queue is empty or not */
  public get isEmpty() {
    return this.length === 0;
  }
  /** Check if the queue is ended or not */
  public get isEnd() {
    return this.size <= this.currentId + 1;
  }
  /** Get the queue's duration */
  public get durationLength() {
    return this.reduce((acc, cur) => acc + (cur.length || 0), 0);
  }

  /** Current playing trackId */
  public currentId: number = 0;

  public get current(): KazagumoTrack | undefined {
    return this.at(this.currentId);
  }
  /**
   * Add track(s) to the queue
   * @param track KazagumoTrack to add
   * @returns KazagumoQueue
   */
  public add(track: KazagumoTrack | KazagumoTrack[]): KazagumoQueue {
    if (Array.isArray(track) && track.some((t) => !(t instanceof KazagumoTrack)))
      throw new KazagumoError(1, 'Track must be an instance of KazagumoTrack');
    if (!Array.isArray(track) && !(track instanceof KazagumoTrack)) track = [track];

    if (Array.isArray(track)) for (const t of track) this.push(t);
    else this.push(track);
    // ; Array.isArray(track) ? this.push(...track) : this.push(track);
    return this;
  }

  /**
   * Remove track from the queue
   * @param position Position of the track
   * @returns KazagumoQueue
   */
  public remove(position: number): KazagumoQueue {
    if (position < 0 || position >= this.length)
      throw new KazagumoError(1, 'Position must be between 0 and ' + (this.length - 1));
    this.splice(position, 1);
    return this;
  }

  /** Shuffle the queue */
  public shuffle(): KazagumoQueue {
    for (let i = this.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [this[i], this[j]] = [this[j], this[i]];
    }
    return this;
  }

  /** Clear the queue */
  public clear(): KazagumoQueue {
    this.splice(0, this.length);
    return this;
  }
}
