#pragma once

class Matrix4; // 前向声明

class Quaternion {
public:
    float x, y, z, w;

    Quaternion(float x = 0, float y = 0, float z = 0, float w = 1);

    static Quaternion fromEuler(float rx, float ry, float rz); // 欧拉角（弧度）
    Matrix4 toMatrix() const; // 转换为旋转矩阵
    Quaternion slerp(const Quaternion& other, float t) const;
    Quaternion normalize() const;
};