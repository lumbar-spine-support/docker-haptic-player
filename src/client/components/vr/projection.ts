import type { VrEye, VrFormat } from './types';

export interface VrViewport {
    x: number;
    y: number;
    width: number;
    height: number;
}

export interface VrProjection {
    upload(video: HTMLVideoElement): void;
    draw(viewport: VrViewport, projection: Float32Array, rotation: Float32Array, eye: VrEye): void;
    dispose(): void;
}

const VERTEX = `#version 300 es
const vec2 POS[3] = vec2[3](vec2(-1.0, -1.0), vec2(3.0, -1.0), vec2(-1.0, 3.0));
out vec2 vNdc;
void main() {
    vNdc = POS[gl_VertexID];
    gl_Position = vec4(vNdc, 0.0, 1.0);
}`;

// Ray per pixel from inverse(projection) and the camera rotation, mapped to the 180° equirect half of one eye.
const FRAGMENT = `#version 300 es
precision highp float;
in vec2 vNdc;
uniform mat4 uProjection;
uniform mat4 uRotation;
uniform vec4 uEyeRect;
uniform sampler2D uTexture;
out vec4 outColor;
const float PI = 3.141592653589793;
void main() {
    vec4 p = inverse(uProjection) * vec4(vNdc, -1.0, 1.0);
    vec3 dir = normalize((uRotation * vec4(normalize(p.xyz / p.w), 0.0)).xyz);
    float lon = atan(dir.x, -dir.z);
    float lat = asin(clamp(dir.y, -1.0, 1.0));
    if (abs(lon) > PI * 0.5) { outColor = vec4(0.0, 0.0, 0.0, 1.0); return; }
    vec2 uv = vec2(lon / PI + 0.5, lat / PI + 0.5);
    outColor = texture(uTexture, uEyeRect.xy + uv * uEyeRect.zw);
}`;

function compile(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader {
    const shader = gl.createShader(type);
    if (!shader) throw new Error('VR: createShader failed');
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        const log = gl.getShaderInfoLog(shader);
        gl.deleteShader(shader);
        throw new Error(`VR: shader compile failed: ${log}`);
    }
    return shader;
}

/** Texture rect (offset xy, scale zw) of one eye; v = 1 is the top of the frame because of UNPACK_FLIP_Y. */
function eyeRect(format: VrFormat, eye: VrEye): [number, number, number, number] {
    if (format.layout === 'sbs') return [eye === 'left' ? 0 : 0.5, 0, 0.5, 1];
    return [0, eye === 'left' ? 0.5 : 0, 1, 0.5];
}

/** Renders a VR180 video frame for any camera; shared by the inline and immersive views. */
export function createVrProjection(gl: WebGL2RenderingContext, format: VrFormat): VrProjection {
    const program = gl.createProgram();
    const vs = compile(gl, gl.VERTEX_SHADER, VERTEX);
    const fs = compile(gl, gl.FRAGMENT_SHADER, FRAGMENT);
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);
    gl.deleteShader(vs);
    gl.deleteShader(fs);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
        throw new Error(`VR: program link failed: ${gl.getProgramInfoLog(program)}`);
    }
    const uProjection = gl.getUniformLocation(program, 'uProjection');
    const uRotation = gl.getUniformLocation(program, 'uRotation');
    const uEyeRect = gl.getUniformLocation(program, 'uEyeRect');
    const uTexture = gl.getUniformLocation(program, 'uTexture');
    const vao = gl.createVertexArray();

    const texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([0, 0, 0, 255]));

    return {
        upload(video) {
            if (video.readyState < 2) return;
            gl.bindTexture(gl.TEXTURE_2D, texture);
            gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, video);
        },
        draw(viewport, projection, rotation, eye) {
            gl.viewport(viewport.x, viewport.y, viewport.width, viewport.height);
            gl.useProgram(program);
            gl.bindVertexArray(vao);
            gl.activeTexture(gl.TEXTURE0);
            gl.bindTexture(gl.TEXTURE_2D, texture);
            gl.uniform1i(uTexture, 0);
            gl.uniformMatrix4fv(uProjection, false, projection);
            gl.uniformMatrix4fv(uRotation, false, rotation);
            gl.uniform4fv(uEyeRect, eyeRect(format, eye));
            gl.drawArrays(gl.TRIANGLES, 0, 3);
        },
        dispose() {
            gl.deleteTexture(texture);
            gl.deleteVertexArray(vao);
            gl.deleteProgram(program);
        },
    };
}
