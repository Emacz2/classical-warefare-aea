// Utility function used in both noises as an ease curve
function easeCurve(t)
{
	return t*t*t*(t*(t*6-15)+10);
}

// Find mod of number but only positive values
function modPos(num, m)
{
	let p = num % m;
	if (p < 0)
		p += m;

	return p;
}

/**
 * @class Noise2D
 * @brief Class representing 2D noise with a given base frequency
 *
 * @param {number} freq - The base frequency (grid resolution) of the noise.
 *                        Determines the number of gradient vectors along each axis.
 */
function Noise2D(freq)
{
	freq = Math.floor(freq);
	this.freq = freq;
	this.grads = [];

	for (let i=0; i < freq; ++i)
	{
		this.grads[i] = [];
		for (let j=0; j < freq; ++j)
		{
			const a = randomAngle();
			this.grads[i][j] = new Vector2D(Math.cos(a), Math.sin(a));
		}
	}
}

Noise2D.prototype.get = function(x, y)
{
	x *= this.freq;
	y *= this.freq;

	const ix = modPos(Math.floor(x), this.freq);
	const iy = modPos(Math.floor(y), this.freq);

	const fx = x - ix;
	const fy = y - iy;

	const ix1 = (ix+1) % this.freq;
	const iy1 = (iy+1) % this.freq;

	const s = this.grads[ix][iy].dot(new Vector2D(fx, fy));
	const t = this.grads[ix1][iy].dot(new Vector2D(fx-1, fy));
	const u = this.grads[ix][iy1].dot(new Vector2D(fx, fy-1));
	const v = this.grads[ix1][iy1].dot(new Vector2D(fx-1, fy-1));

	const ex = easeCurve(fx);
	const ey = easeCurve(fy);
	const a = s + ex*(t-s);
	const b = u + ex*(v-u);
	return (a + ey*(b-a)) * 0.5 + 0.5;
};

/**
 * @class Noise3D
 * @brief Class representing 3D noise with given base frequencies
 *
 * @param {number} freq - The base frequency (grid resolution) of the noise.
 *     Determines the number of gradient vectors along the first to axis.
 * @param {number} vfreq - The base frequency for the third dimension.
 */
function Noise3D(freq, vfreq)
{
	freq = Math.floor(freq);
	vfreq = Math.floor(vfreq);
	this.freq = freq;
	this.vfreq = vfreq;
	this.grads = [];

	for (let i=0; i < freq; ++i)
	{
		this.grads[i] = [];
		for (let j=0; j < freq; ++j)
		{
			this.grads[i][j] = [];
			for (let k=0; k < vfreq; ++k)
			{
				const v = new Vector3D();
				do
				{
					v.set(randFloat(-1, 1), randFloat(-1, 1), randFloat(-1, 1));
				}
				while (v.lengthSquared() > 1 || v.lengthSquared() < 0.1);

				v.normalize();

				this.grads[i][j][k] = v;
			}
		}
	}
}

Noise3D.prototype.get = function(x, y, z)
{
	x *= this.freq;
	y *= this.freq;
	z *= this.vfreq;

	const ix =modPos(Math.floor(x), this.freq);
	const iy = modPos(Math.floor(y), this.freq);
	const iz = modPos(Math.floor(z), this.vfreq);

	const fx = x - ix;
	const fy = y - iy;
	const fz = z - iz;

	const ix1 = (ix+1) % this.freq;
	const iy1 = (iy+1) % this.freq;
	const iz1 = (iz+1) % this.vfreq;

	const s0 = this.grads[ix][iy][iz].dot(new Vector3D(fx, fy, fz));
	const t0 = this.grads[ix1][iy][iz].dot(new Vector3D(fx-1, fy, fz));
	const u0 = this.grads[ix][iy1][iz].dot(new Vector3D(fx, fy-1, fz));
	const v0 = this.grads[ix1][iy1][iz].dot(new Vector3D(fx-1, fy-1, fz));

	const s1 = this.grads[ix][iy][iz1].dot(new Vector3D(fx, fy, fz-1));
	const t1 = this.grads[ix1][iy][iz1].dot(new Vector3D(fx-1, fy, fz-1));
	const u1 = this.grads[ix][iy1][iz1].dot(new Vector3D(fx, fy-1, fz-1));
	const v1 = this.grads[ix1][iy1][iz1].dot(new Vector3D(fx-1, fy-1, fz-1));

	const ex = easeCurve(fx);
	const ey = easeCurve(fy);
	const ez = easeCurve(fz);

	const a0 = s0 + ex*(t0-s0);
	const b0 = u0 + ex*(v0-u0);
	const c0 = a0 + ey*(b0-a0);

	const a1 = s1 + ex*(t1-s1);
	const b1 = u1 + ex*(v1-u1);
	const c1 = a1 + ey*(b1-a1);

	return (c0 + ez*(c1-c0)) * 0.5 + 0.5;
};
