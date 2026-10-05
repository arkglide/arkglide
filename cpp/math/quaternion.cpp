#include "quaternion.h"
#include "matrix4.h"
#include <cmath>
#include <emscripten/bind.h>

Quaternion::Quaternion(float x, float y, float z, float w) : x(x), y(y), z(z), w(w) {}

Quaternion Quaternion::fromEuler(float rx, float ry, float rz) {
    float cx = std::cos(rx * 0.5f), sx = std::sin(rx * 0.5f);
    float cy = std::cos(ry * 0.5f), sy = std::sin(ry * 0.5f);
    float cz = std::cos(rz * 0.5f), sz = std::sin(rz * 0.5f);

    return Quaternion(
        sx * cy * cz - cx * sy * sz,
        cx * sy * cz + sx * cy * sz,
        cx * cy * sz - sx * sy * cz,
        cx * cy * cz + sx * sy * sz
    );
}

Matrix4 Quaternion::toMatrix() const {
    float xx = x*x, yy = y*y, zz = z*z;
    float xy = x*y, xz = x*z, yz = y*z;
    float wx = w*x, wy = w*y, wz = w*z;

    Matrix4 r;
    r.m[0]  = 1 - 2*(yy+zz); r.m[4]  = 2*(xy-wz);     r.m[8]  = 2*(xz+wy);     r.m[12] = 0;
    r.m[1]  = 2*(xy+wz);     r.m[5]  = 1 - 2*(xx+zz); r.m[9]  = 2*(yz-wx);     r.m[13] = 0;
    r.m[2]  = 2*(xz-wy);     r.m[6]  = 2*(yz+wx);     r.m[10] = 1 - 2*(xx+yy); r.m[14] = 0;
    r.m[3]  = 0;             r.m[7]  = 0;             r.m[11] = 0;             r.m[15] = 1;
    return r;
}

Quaternion Quaternion::slerp(const Quaternion& other, float t) const {
    float cosHalfTheta = w * other.w + x * other.x + y * other.y + z * other.z;

    if (std::abs(cosHalfTheta) >= 1.0f) {
        return *this; // 四元数相同
    }

    float halfTheta = std::acos(cosHalfTheta);
    float sinHalfTheta = std::sqrt(1.0f - cosHalfTheta * cosHalfTheta);

    if (std::abs(sinHalfTheta) < 1e-6f) {
        return Quaternion(
            x * 0.5f + other.x * 0.5f,
            y * 0.5f + other.y * 0.5f,
            z * 0.5f + other.z * 0.5f,
            w * 0.5f + other.w * 0.5f
        );
    }

    float ratioA = std::sin((1 - t) * halfTheta) / sinHalfTheta;
    float ratioB = std::sin(t * halfTheta) / sinHalfTheta;

    return Quaternion(
        x * ratioA + other.x * ratioB,
        y * ratioA + other.y * ratioB,
        z * ratioA + other.z * ratioB,
        w * ratioA + other.w * ratioB
    );
}

Quaternion Quaternion::normalize() const {
    float len = std::sqrt(x*x + y*y + z*z + w*w);
    if (len == 0) return Quaternion(0, 0, 0, 1);
    return Quaternion(x/len, y/len, z/len, w/len);
}

EMSCRIPTEN_BINDINGS(arkglide_quaternion) {
    emscripten::class_<Quaternion>("Quaternion")
        .constructor<float, float, float, float>()
        .property("x", &Quaternion::x)
        .property("y", &Quaternion::y)
        .property("z", &Quaternion::z)
        .property("w", &Quaternion::w)
        .function("slerp", &Quaternion::slerp)
        .function("normalize", &Quaternion::normalize)
        .function("toMatrix", &Quaternion::toMatrix)
        .class_function("fromEuler", &Quaternion::fromEuler);
}