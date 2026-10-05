#pragma once

class Vector3 {
public:
    float x, y, z;

    Vector3(float x = 0, float y = 0, float z = 0);

    Vector3 add(const Vector3& other) const;
    Vector3 sub(const Vector3& other) const;
    Vector3 scale(float s) const;
    float length() const;
    Vector3 normalize() const;
    Vector3 cross(const Vector3& other) const;
    float dot(const Vector3& other) const;
    Vector3 lerp(const Vector3& other, float t) const;
    float distance(const Vector3& other) const;
    bool equals(const Vector3& other, float epsilon = 1e-6f) const;
};

// 自由函数：两个向量相加
Vector3 addVectors(Vector3 a, Vector3 b);