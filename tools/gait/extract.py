"""Measure a BVH clip (CMU, MotionBuilder-style names) in the terms of the College Blitz
pose rig and fold it into one averaged, looping gait cycle.

usage: python3 extract.py clip.bvh [--plot]
prints JSON: {clip, speed (leg lengths/s), stride (leg lengths per cycle), n, table{param: [..]}}
"""
import sys, json, math
import numpy as np

def parse(path):
    lines = open(path).read().split('\n')
    joints, stack, order = {}, [], []
    i = 0
    cur = None
    while not lines[i].strip().startswith('MOTION'):
        t = lines[i].split()
        if t and t[0] in ('ROOT', 'JOINT'):
            cur = {'name': t[1], 'parent': stack[-1] if stack else None, 'offset': None, 'channels': []}
            joints[t[1]] = cur
            order.append(t[1])
        elif t and t[0] == 'End':
            cur = {'name': None, 'end': True}
        elif t and t[0] == '{':
            stack.append(cur['name'] if cur and cur.get('name') else '__end__')
        elif t and t[0] == '}':
            stack.pop()
        elif t and t[0] == 'OFFSET' and cur and cur.get('name'):
            cur['offset'] = np.array([float(v) for v in t[1:4]])
        elif t and t[0] == 'CHANNELS':
            cur['channels'] = t[2:]
        i += 1
    i += 1
    nf = int(lines[i].split()[1]); i += 1
    ft = float(lines[i].split()[2]); i += 1
    data = np.array([[float(v) for v in l.split()] for l in lines[i:i + nf] if l.strip()])
    return joints, order, data, ft

def rot(axis, deg):
    a = math.radians(deg)
    c, s = math.cos(a), math.sin(a)
    if axis == 'X': return np.array([[1, 0, 0], [0, c, -s], [0, s, c]])
    if axis == 'Y': return np.array([[c, 0, s], [0, 1, 0], [-s, 0, c]])
    return np.array([[c, -s, 0], [s, c, 0], [0, 0, 1]])

def fk(joints, order, data):
    nf = len(data)
    pos = {n: np.zeros((nf, 3)) for n in order}
    for f in range(nf):
        k = 0
        R = {}
        for n in order:
            j = joints[n]
            ch = j['channels']
            vals = data[f, k:k + len(ch)]; k += len(ch)
            t = np.zeros(3)
            Rl = np.eye(3)
            for c, v in zip(ch, vals):
                if c.endswith('position'): t['XYZ'.index(c[0])] = v
                else: Rl = Rl @ rot(c[0], v)
            if j['parent'] is None:
                R[n] = Rl
                pos[n][f] = j['offset'] + t
            else:
                p = j['parent']
                pos[n][f] = pos[p][f] + R[p] @ j['offset']
                R[n] = R[p] @ Rl
    return pos

def unit(v):
    return v / (np.linalg.norm(v, axis=-1, keepdims=True) + 1e-9)

def main():
    path = sys.argv[1]
    joints, order, data, ft = parse(path)
    P = fk(joints, order, data)
    nf = len(data)
    fps = 1 / ft
    U = np.array([0, 1, 0.0])
    # leg length from the T pose (frame 0)
    leg = np.linalg.norm(P['LeftLeg'][0] - P['LeftUpLeg'][0]) + np.linalg.norm(P['LeftFoot'][0] - P['LeftLeg'][0])
    hip0 = P['Hips'][0][1] - min(P['LeftToeBase'][0][1], P['LeftFoot'][0][1])
    # heading from the smoothed horizontal hip velocity (a backpedal faces against it)
    hp = P['Hips'].copy()
    w = int(fps * 0.4)
    k = np.ones(w) / w
    sm = np.stack([np.convolve(hp[:, c], k, mode='same') for c in range(3)], 1)
    vel = np.gradient(sm, axis=0) * fps
    vel[:, 1] = 0
    speed = np.linalg.norm(vel, axis=1)
    back = '--back' in sys.argv
    F = unit(vel) * (-1 if back else 1)
    L = np.cross(U, F)
    def comp(v):
        return (v * F).sum(1), (v * U).sum(1), (v * L).sum(1)
    out = {}
    floor = np.minimum(P['LeftToeBase'][:, 1], P['RightToeBase'][:, 1]).min()
    for side, tag, idx in [(-1, 'Right', 0), (1, 'Left', 1)]:
        hip, knee, ank, toe = P[f'{tag}UpLeg'], P[f'{tag}Leg'], P[f'{tag}Foot'], P[f'{tag}ToeBase']
        t = unit(knee - hip); s = unit(ank - knee); fo = unit(toe - ank)
        tf, tu, tl = comp(t)
        out[f'legFwd{idx}'] = np.arctan2(tf, -tu)
        out[f'legAbd{idx}'] = np.arctan2(side * tl, -tu)
        out[f'knee{idx}'] = np.arccos(np.clip((t * s).sum(1), -1, 1))
        ff, fu, _ = comp(fo)
        # foot pitch (toes down +) relative to its pitch in the T pose
        ft0 = np.arctan2(-(toe[0] - ank[0])[1], np.linalg.norm((toe[0] - ank[0])[[0, 2]]))
        out[f'footPitch{idx}'] = np.arctan2(-fu, ff) - ft0
        sh, el, wr = P[f'{tag}Arm'], P[f'{tag}ForeArm'], P[f'{tag}Hand']
        a = unit(el - sh); fa = unit(wr - el)
        af, au, al = comp(a)
        out[f'armAbdTotal{idx}'] = np.arcsin(np.clip(side * al, -1, 1))
        out[f'armFwd{idx}'] = np.arctan2(af, -au)
        out[f'elbow{idx}'] = np.arccos(np.clip((a * fa).sum(1), -1, 1))
    neck = P['Neck'] if 'Neck' in P else P['Neck1']
    sp = neck - P['Hips']
    sf, su, sl = comp(sp)
    out['lean'] = np.arctan2(sf, su)
    shl = P['LeftArm'] - P['RightArm']
    hpl = P['LeftUpLeg'] - P['RightUpLeg']
    a1, b1, c1 = comp(shl)
    a2, b2, c2 = comp(hpl)
    out['twist'] = np.arctan2(-a1, c1)
    out['hipTwist'] = np.arctan2(-a2, c2)
    out['roll'] = np.arctan2(b2, c2)
    out['bodyY'] = (P['Hips'][:, 1] - floor - hip0) / leg  # in leg lengths
    # half strides: a left-thigh peak to the next right-thigh peak, plus the mirrored right-to-left
    # halves; a symmetric loop is one averaged half and its mirror
    def peaks_of(arr):
        k2 = np.ones(9) / 9
        a2 = np.convolve(arr, k2, mode='same')
        r = int(fps * 0.12)
        pk = [i for i in range(r, nf - r) if a2[i] == a2[i - r:i + r + 1].max() and a2[i] > np.percentile(a2, 60)]
        return pk
    pl = peaks_of(out['legFwd1'])
    pr = peaks_of(out['legFwd0'])
    ev = sorted([(i, 'L') for i in pl] + [(i, 'R') for i in pr])
    SIDE = [k[:-1] for k in out if k.endswith('0')]
    def mirror(d):
        m = dict(d)
        for k in SIDE:
            m[k + '0'], m[k + '1'] = d[k + '1'], d[k + '0']
        for k in ('twist', 'hipTwist', 'roll'):
            m[k] = -d[k]
        return m
    H = 16
    halves = []
    durs = []
    for (i0, s0), (i1, s1) in zip(ev[:-1], ev[1:]):
        if s0 == s1 or (i1 - i0) < fps * 0.15 or (i1 - i0) > fps * 0.7:
            continue
        tt = np.linspace(i0, i1, H + 1)
        half = {k: np.interp(tt, np.arange(nf), a) for k, a in out.items()}
        halves.append(half if s0 == 'L' else mirror(half))
        durs.append((i1 - i0) / fps)
    if not halves:
        raise SystemExit('no half strides found')
    avg = {k: np.mean([h[k] for h in halves], 0) for k in out}
    # make the loop seamless: the half must end where its mirror starts (the subject runs a
    # little lopsided); spread the difference along the half
    start = mirror({k: avg[k][0] for k in out})
    ramp = np.linspace(0, 1, H + 1)
    for k in out:
        avg[k] = avg[k] + (start[k] - avg[k][-1]) * ramp
    avg = {k: v[:-1] for k, v in avg.items()}
    mir = mirror(avg)
    table = {k: np.concatenate([avg[k], mir[k]]) for k in out}
    period = 2 * float(np.mean(durs))
    lo_, hi_ = min(i for i, _ in ev), max(i for i, _ in ev)
    sp_mean = float((speed[lo_:hi_] / leg).mean())
    res = {
        'clip': path.split('/')[-1], 'halves': len(halves), 'period_s': period,
        'speed': sp_mean, 'stride': sp_mean * period,
        'n': 2 * H, 'table': {k: [round(float(v), 3) for v in a] for k, a in table.items()},
    }
    print(json.dumps(res))

main()
