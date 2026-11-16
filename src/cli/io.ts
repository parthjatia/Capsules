// Commands write through this, so tests can capture output and the CLI stays free of console.*.
export interface Io {
  cwd: string;
  out: (text: string) => void;
  err: (text: string) => void;
}

export const processIo = (): Io => ({
  cwd: process.cwd(),
  out: (t) => void process.stdout.write(t),
  err: (t) => void process.stderr.write(t),
});
