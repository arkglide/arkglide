#include "matrix4.h"
#include <cmath>
#include <cstring>
#include <emscripten/bind.h>

// 注意：默认构造函数直接初始化为单位矩阵，不能调用 identity()，
// 否则 identity() 内的 `Matrix4 r;` 会再次触发默认构造，导致无限递归。
Matrix4::Matrix4() {
    std::memset(m, 0, sizeof(m));
    m[0] = 1; m[5] = 1; m[10] = 1; m[15] = 1;
}

Matrix4 Matrix4::identity() {
    Matrix4 r;
    return r;
}

Matrix4 Matrix4::multiply(const Matrix4& other) const {
    Matrix4 r;
    for (int col = 0; col < 4; col++) {
        for (int row = 0; row < 4; row++) {
            float sum = 0;
            for (int k = 0; k < 4; k++) {
                sum += m[k * 4 + row] * other.m[col * 4 + k];
            }
            r.m[col * 4 + row] = sum;
        }
    }
    return r;
}

Matrix4 Matrix4::translate(float x, float y, float z) {
    Matrix4 r = identity();
    r.m[12] = x; r.m[13] = y; r.m[14] = z;
    return r;
}

Matrix4 Matrix4::rotate(float angleRad, float x, float y, float z) {
    // 归一化轴
    float len = std::sqrt(x * x + y * y + z * z);
    if (len == 0) return identity();
    x /= len; y /= len; z /= len;

    float c = std::cos(angleRad);
    float s = std::sin(angleRad);
    float t = 1 - c;

    Matrix4 r;
    r.m[0]  = t*x*x + c;   r.m[4]  = t*x*y - s*z; r.m[8]  = t*x*z + s*y;  r.m[12] = 0;
    r.m[1]  = t*x*y + s*z;  r.m[5]  = t*y*y + c;   r.m[9]  = t*y*z - s*x;  r.m[13] = 0;
    r.m[2]  = t*x*z - s*y;  r.m[6]  = t*y*z + s*x; r.m[10] = t*z*z + c;    r.m[14] = 0;
    r.m[3]  = 0;            r.m[7]  = 0;           r.m[11] = 0;            r.m[15] = 1;
    return r;
}

Matrix4 Matrix4::scale(float x, float y, float z) {
    Matrix4 r = identity();
    r.m[0] = x; r.m[5] = y; r.m[10] = z;
    return r;
}

float Matrix4::get(int index) const {
    if (index < 0 || index >= 16) return 0.0f;
    return m[index];
}

void Matrix4::set(int index, float value) {
    if (index < 0 || index >= 16) return;
    m[index] = value;
}

EMSCRIPTEN_BINDINGS(arkglide_matrix4) {
    emscripten::class_<Matrix4>("Matrix4")
        .constructor<>()
        .function("multiply", &Matrix4::multiply)
        .function("get", &Matrix4::get)
        .function("set", &Matrix4::set)
        .class_function("identity", &Matrix4::identity)
        .class_function("translate", &Matrix4::translate)
        .class_function("rotate", &Matrix4::rotate)
        .class_function("scale", &Matrix4::scale);
}