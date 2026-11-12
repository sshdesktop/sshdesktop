export const sq = (value: string): string => `'${String(value).replace(/'/g, "'\\''")}'`;

export interface DockerRunOptions {
  image: string;
  name?: string;
  restart?: string;
  memoryLimit?: string;
  cpuLimit?: string;
  pidsLimit?: string;
  ports?: string;
  volumes?: string;
  env?: string;
}

export function buildDockerRunCommand(opts: DockerRunOptions): string {
  const image = String(opts.image || '').trim();
  if (!image) {
    throw new Error('Please specify a Docker image name.');
  }

  let cmd = 'docker run -d';
  const name = String(opts.name || '').trim();
  if (name) {
    if (!/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}$/.test(name)) {
      throw new Error('Invalid container name. Use letters, numbers, ".", "_", or "-".');
    }
    cmd += ` --name ${sq(name)}`;
  }

  const restart = String(opts.restart || '').trim();
  if (restart) {
    cmd += ` --restart ${sq(restart)}`;
  }

  const memory = String(opts.memoryLimit || '').trim();
  if (memory) {
    if (!/^\d+[bkmgBKMG]?$/.test(memory)) {
      throw new Error('Invalid memory limit (use format like 512m or 2g).');
    }
    cmd += ` --memory ${sq(memory)}`;
  }

  const cpus = String(opts.cpuLimit || '').trim();
  if (cpus) {
    if (!/^\d+(?:\.\d+)?$/.test(cpus)) {
      throw new Error('Invalid CPU limit (use numeric value like 0.5 or 2).');
    }
    cmd += ` --cpus ${sq(cpus)}`;
  }

  const pids = String(opts.pidsLimit || '').trim();
  if (pids) {
    if (!/^\d+$/.test(pids)) {
      throw new Error('Invalid PIDs limit (use a positive integer like 256).');
    }
    cmd += ` --pids-limit ${sq(pids)}`;
  }

  const splitList = (raw?: string) =>
    String(raw || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);

  for (const p of splitList(opts.ports)) {
    cmd += ` -p ${sq(p)}`;
  }
  for (const v of splitList(opts.volumes)) {
    cmd += ` -v ${sq(v)}`;
  }
  for (const envItem of splitList(opts.env)) {
    cmd += ` -e ${sq(envItem)}`;
  }

  cmd += ` ${sq(image)}`;
  return cmd;
}
