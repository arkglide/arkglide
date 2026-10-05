#pragma once

class Matrix4 {
public:
    float m[16]; // 列主序（OpenGL 风格）

    Matrix4(); // 默认 identity

    static Matrix4 identity();
    Matrix4 multiply(const Matrix4& other) const;
    static Matrix4 translate(float x, float y, float z);
    static Matrix4 rotate(float angleRad, float x, float y, float z); // 绕轴旋转
    static Matrix4 scale(float x, float y, float z);

    // embind 不直接支持 C 数组作为 property，用 get/set 让 JS 读写矩阵元素
    float get(int index) const;
    void set(int index, float value);
};