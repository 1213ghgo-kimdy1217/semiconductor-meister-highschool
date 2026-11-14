import { MAX_LINE as MAX_CONTENT } from './v1';

export type LineEvent = { type: 'line'; line: string } | { type: 'overflow'; preview: string };

/**
 * 시리얼 조각을 LF 단위 줄로 모은다.
 * - 한 줄이 여러 조각으로 나뉘어 오거나, 여러 줄이 한 조각에 붙어 와도 같은 결과
 * - CR LF 허용 (Serial.println)
 * - 최대 길이를 넘는 줄은 다음 LF까지 통째로 버리고 overflow로 알린다
 */
export class LineBuffer {
  private buf = '';
  private dropping = false;

  push(chunk: string): LineEvent[] {
    const out: LineEvent[] = [];
    let data = chunk;
    if (this.dropping) {
      const i = data.indexOf('\n');
      if (i < 0) return out;
      data = data.slice(i + 1);
      this.dropping = false;
    }
    this.buf += data;
    let idx: number;
    while ((idx = this.buf.indexOf('\n')) >= 0) {
      let seg = this.buf.slice(0, idx);
      this.buf = this.buf.slice(idx + 1);
      if (seg.endsWith('\r')) seg = seg.slice(0, -1);
      if (seg.length === 0) continue;
      if (seg.length > MAX_CONTENT) {
        out.push({ type: 'overflow', preview: seg.slice(0, 24) });
        continue;
      }
      out.push({ type: 'line', line: seg });
    }
    // 아직 LF가 오지 않은 조각이 한계를 넘으면 그 줄은 버린다 (CR 한 글자 여유)
    if (this.buf.length > MAX_CONTENT + 1) {
      out.push({ type: 'overflow', preview: this.buf.slice(0, 24) });
      this.buf = '';
      this.dropping = true;
    }
    return out;
  }

  reset() {
    this.buf = '';
    this.dropping = false;
  }
}
