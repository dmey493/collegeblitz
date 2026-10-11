"""Measure a stretch of a BVH clip (CMU, MotionBuilder-style names) as a timeline in the
terms of the College Blitz pose rig, with the pelvis free to tilt and roll (lying, kneeling,
getting up). Angles are body-relative: legs in the pelvis frame, the chest relative to the
pelvis, arms in the chest frame; the pelvis in a heading frame that faces the way the actor
ends up facing.

usage: python3 measure.py clip.bvh start_s end_s [samples]  -> JSON on stdout
"""
import sys, json, math
import numpy as np
from extract import parse, fk


def unit(v):
    return v / (np.linalg.norm(v) + 1e-9)


def frame_of(left, up):
    """Orthonormal basis (columns: left, up, forward) from a left vector and a rough up."""
    L = unit(left)
    U = unit(up - (up @ L) * L)
    F = np.cross(L, U)
    return np.stack([L, U, F], 1)


def euler_xyz(R):
    """Angles (a, b, c) with R = Rx(a) Ry(b) Rz(c) (three.js 'XYZ')."""
    b = math.asin(max(-1.0, min(1.0, R[0, 2])))
    a = math.atan2(-R[1, 2], R[2, 2])
    c = math.atan2(-R[0, 1], R[0, 0])
    return a, b, c


def rx(t):
    c, s = math.cos(t), math.sin(t)
    return np.array([[1, 0, 0], [0, c, -s], [0, s, c]])


def rz(t):
    c, s = math.cos(t), math.sin(t)
    return np.array([[c, -s, 0], [s, c, 0], [0, 0, 1]])


def main():
    path, t0, t1 = sys.argv[1], float(sys.argv[2]), float(sys.argv[3])
    N = int(sys.argv[4]) if len(sys.argv) > 4 else 40
    joints, order, data, ft = parse(path)
    P = fk(joints, order, data)
    fps = 1 / ft
    nf = len(data)
    leg = np.linalg.norm(P['LeftLeg'][0] - P['LeftUpLeg'][0]) + np.linalg.norm(P['LeftFoot'][0] - P['LeftLeg'][0])
    # (in the CMU skeleton Neck sits on Spine1; Neck1 is the base of the neck proper)
    neck = 'Neck1' if 'Neck1' in P else 'Neck'

    def pelvis(f):
        return frame_of(P['LeftUpLeg'][f] - P['RightUpLeg'][f], P['Spine1'][f] - P['Hips'][f])

    def chest(f):
        return frame_of(P['LeftArm'][f] - P['RightArm'][f], P[neck][f] - P['Spine1'][f])

    # heading: where the actor faces at the end, flattened
    fe = int(min(nf - 1, t1 * fps))
    Fh = pelvis(fe)[:, 2].copy()
    Fh[1] = 0
    Fh = unit(Fh)
    Uh = np.array([0, 1.0, 0])
    H = np.stack([np.cross(Uh, Fh), Uh, Fh], 1)  # columns: left, up, forward (world)
    stand = P['Hips'][fe]
    # T pose foot pitch in the pelvis frame
    foot0 = {}
    for tag in ('Left', 'Right'):
        fv = pelvis(0).T @ (P[f'{tag}ToeBase'][0] - P[f'{tag}Foot'][0])
        foot0[tag] = math.atan2(-fv[1], fv[2])
    keys = ['tiltX', 'hipTwist', 'tiltZ', 'lean', 'twist', 'bend', 'headX', 'bodyY', 'bodyZ', 'bodyX']
    for i in (0, 1):
        keys += [f'legFwd{i}', f'legAbd{i}', f'knee{i}', f'foot{i}', f'armFwd{i}', f'armAbdTotal{i}', f'armTwist{i}', f'elbow{i}']
    out = {k: [] for k in keys}
    for s in range(N + 1):
        tt = t0 + (t1 - t0) * s / N
        f = int(round(min(nf - 1, max(1, tt * fps))))
        Rp = pelvis(f)
        Rc = chest(f)
        a, b, c = euler_xyz(H.T @ Rp)
        out['tiltX'].append(a)
        out['hipTwist'].append(b)
        out['tiltZ'].append(c)
        la, lb, lc = euler_xyz(Rp.T @ Rc)
        out['lean'].append(la)
        out['twist'].append(lb + b)  # the rig's twist is the chest's yaw in the heading frame
        out['bend'].append(lc)
        hv = Rc.T @ (P['Head'][f] - P[neck][f])
        out['headX'].append(math.atan2(hv[2], hv[1]) + la * 0.55)
        d = H.T @ (P['Hips'][f] - stand)
        out['bodyY'].append(d[1] / leg)
        out['bodyZ'].append(d[2] / leg)
        out['bodyX'].append(d[0] / leg)
        for i, (side, tag) in enumerate([(-1, 'Right'), (1, 'Left')]):
            th = Rp.T @ unit(P[f'{tag}Leg'][f] - P[f'{tag}UpLeg'][f])
            sh = Rp.T @ unit(P[f'{tag}Foot'][f] - P[f'{tag}Leg'][f])
            fo = Rp.T @ (P[f'{tag}ToeBase'][f] - P[f'{tag}Foot'][f])
            lf = math.atan2(th[2], -th[1])
            out[f'legFwd{i}'].append(lf)
            out[f'legAbd{i}'].append(math.asin(max(-1, min(1, side * th[0]))))
            kn = math.acos(max(-1, min(1, th @ sh)))
            out[f'knee{i}'].append(kn)
            out[f'foot{i}'].append(math.atan2(-fo[1], fo[2]) - foot0[tag] + lf - kn)
            ua = Rc.T @ unit(P[f'{tag}ForeArm'][f] - P[f'{tag}Arm'][f])
            fa = Rc.T @ unit(P[f'{tag}Hand'][f] - P[f'{tag}ForeArm'][f])
            fwd = math.atan2(ua[2], -ua[1])
            abd = math.asin(max(-1, min(1, side * ua[0])))
            out[f'armFwd{i}'].append(fwd)
            out[f'armAbdTotal{i}'].append(abd)
            el = math.acos(max(-1, min(1, ua @ fa)))
            out[f'elbow{i}'].append(el)
            # twist about the upper arm so the elbow bends the way the captured one does
            n = fa - (fa @ ua) * ua
            tw = 0.0
            if np.linalg.norm(n) > 0.05:
                M0 = rx(-fwd) @ rz(side * abd)
                nl = M0.T @ unit(n)
                tw = side * math.atan2(nl[0], nl[2])
            out[f'armTwist{i}'].append(tw)
    # unwrap angle channels so interpolation never spins the long way round
    for k in keys:
        if not k.startswith('body'):
            out[k] = list(np.unwrap(np.array(out[k])))
    res = {'clip': path.split('/')[-1], 'start': t0, 'end': t1, 'n': N + 1,
           't': {k: [round(float(v), 3) for v in a] for k, a in out.items()}}
    print(json.dumps(res))


main()
