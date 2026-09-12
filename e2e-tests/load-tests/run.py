#!/usr/bin/env python3
"""Run the infrastructure k6 journey unchanged, with local defaults and evidence."""
import datetime
import json
import os
import resource
from pathlib import Path
import subprocess
import sys
import threading
import time
import urllib.request

HERE = Path(__file__).resolve().parent


def main():
    if len(sys.argv) != 2:
        raise SystemExit('Usage: run.py /path/to/infrastructure')
    infrastructure = Path(sys.argv[1]).resolve()
    workload = infrastructure / 'helm/erato-stress-test/load-tests'
    if not (workload / 'run.sh').is_file():
        raise SystemExit(f'Missing upstream workload: {workload}')
    env = os.environ.copy()
    defaults = dict(BASE_URL='http://localhost:4180', USERS='1', FIRST_USER='1',
                    DURATION_SECONDS='45', MODEL='Mock LLM', K6_REMOTE_WRITE='0')
    for key, value in defaults.items():
        env.setdefault(key, value)
    if env['K6_REMOTE_WRITE'] != '0' and not env.get('K6_PROMETHEUS_RW_SERVER_URL'):
        raise SystemExit('Local remote write requires an explicit K6_PROMETHEUS_RW_SERVER_URL; no cluster tunnel is opened.')
    if not (workload / '.tools/k6').is_file():
        raise SystemExit(f'First run: cd {workload} && just install')
    # Keep one shared workload. Apply the small upstream diagnostic fix explicitly
    # during setup, rather than silently creating a fork in this repository.
    patch = HERE / 'infrastructure-diagnostics.patch'
    patched = subprocess.run(['git', '-C', str(infrastructure), 'apply', '--reverse', '--check', str(patch)], capture_output=True)
    if patched.returncode:
        raise SystemExit('Apply infrastructure-diagnostics.patch to the infrastructure checkout first; see README.md.')
    stamp = datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%S.%fZ')
    output = Path(env['OUTPUT_DIR']).resolve() if env.get('OUTPUT_DIR') else HERE.parent / 'tmp' / 'latency' / stamp
    output.mkdir(parents=True)
    revision = subprocess.check_output(['git', '-C', str(infrastructure), 'rev-parse', 'HEAD'], text=True).strip()
    metadata = {key: env[key] for key in defaults}
    metadata.update(infrastructure_revision=revision, browser=env.get('LOAD_TEST_BROWSER', 'lightpanda'),
                    backend_revision=subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=HERE, text=True).strip(),
                    resource_limits=env.get('RESOURCE_LIMITS', 'uncontrolled'),
                    history_state=env.get('HISTORY_STATE', 'existing database; no cleanup'),
                    instrumentation=env.get('INSTRUMENTATION', 'unspecified'))
    (output / 'metadata.json').write_text(json.dumps(metadata, indent=2) + '\n')
    stop = threading.Event()
    def sample():
        with (output / 'metrics.jsonl').open('w') as log:
            while not stop.is_set():
                record = {'timestamp': time.time()}
                try:
                    with urllib.request.urlopen(env.get('METRICS_URL', 'http://127.0.0.1:3132/metrics'), timeout=2) as response:
                        record['prometheus'] = response.read().decode()
                except Exception as error:
                    record['error'] = str(error)
                log.write(json.dumps(record) + '\n')
                log.flush()
                stop.wait(2)
    sampler = threading.Thread(target=sample, daemon=True)
    sampler.start()
    print(f'Local evidence: {output}', flush=True)
    try:
        before = resource.getrusage(resource.RUSAGE_CHILDREN)
        with (output / 'run.log').open('w') as log:
            result = subprocess.run(['bash', str(workload / 'run.sh'), env['USERS']], env=env,
                                    stdout=log, stderr=subprocess.STDOUT)
        after = resource.getrusage(resource.RUSAGE_CHILDREN)
        (output / 'generator-resources.json').write_text(json.dumps({
            'user_cpu_seconds': after.ru_utime - before.ru_utime,
            'system_cpu_seconds': after.ru_stime - before.ru_stime,
            'exit_code': result.returncode,
        }, indent=2) + '\n')
        print((output / 'run.log').read_text())
        return result.returncode
    finally:
        stop.set()
        sampler.join(timeout=3)


if __name__ == '__main__':
    sys.exit(main())
