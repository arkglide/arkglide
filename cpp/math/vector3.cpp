#include "vector3.h"
#include <cmath>
#include <emscripten/bind.h>

Vector3::Vector3(float x, float y, float z) : x(x), y(y), z(z) {}

Vector3 Vector3::add(const Vector3& other) const {
    return Vector3(x + other.x, y + other.y, z + other.z);
}

Vector3 Vector3::sub(const Vector3& other) const {
    return Vector3(x - other.x, y - other.y, z - other.z);
}

Vector3 Vector3::scale(float s) const {
    return Vector3(x * s, y * s, z * s);
}

float Vector3::length() const {
    return std::sqrt(x * x + y * y + z * z);
}

Vector3 Vector3::normalize() const {
    float len = length();
    if (len == 0) return Vector3(0, 0, 0);
    return Vector3(x / len, y / len, z / len);
}

Vector3 Vector3::cross(const Vector3& other) const {
    return Vector3(
        y * other.z - z * other.y,
        z * other.x - x * other.z,
        x * other.y - y * other.x
    );
}

float Vector3::dot(const Vector3& other) const {
    return x * other.x + y * other.y + z * other.z;
}

Vector3 Vector3::lerp(const Vector3& other, float t) const {
    return Vector3(
        x + (other.x - x) * t,
        y + (other.y - y) * t,
        z + (other.z - z) * t
    );
}

float Vector3::distance(const Vector3& other) const {
    return sub(other).length();
}

bool Vector3::equals(const Vector3& other, float epsilon) const {
    return std::abs(x - other.x) < epsilon &&
           std::abs(y - other.y) < epsilon &&
           std::abs(z - other.z) < epsilon;
}

Vector3 addVectors(Vector3 a, Vector3 b) {
    return a.add(b);
}

// Emscripten 绑定
EMSCRIPTEN_BINDINGS(arkglide_math) {
    emscripten::class_<Vector3>("Vector3")
        .constructor<float, float, float>()
        .property("x", &Vector3::x)
        .property("y", &Vector3::y)
        .property("z", &Vector3::z)
        .function("add", &Vector3::add)
        .function("sub", &Vector3::sub)
        .function("scale", &Vector3::scale)
        .function("length", &Vector3::length)
        .function("normalize", &Vector3::normalize)
        .function("cross", &Vector3::cross)
        .function("dot", &Vector3::dot)
        .function("lerp", &Vector3::lerp)
        .function("distance", &Vector3::distance)
        .function("equals", &Vector3::equals);

    emscripten::function("addVectors", &addVectors);
}