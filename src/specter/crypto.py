"""ECDSA P-256 keypair + sign/verify. Maps to ATECC608A in Phase 04."""

from cryptography.exceptions import InvalidSignature
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ec

CURVE = ec.SECP256R1()
HASH = hashes.SHA256()


class Keypair:
    def __init__(self, private: ec.EllipticCurvePrivateKey) -> None:
        self._private = private
        self._public = private.public_key()

    @classmethod
    def generate(cls) -> "Keypair":
        return cls(ec.generate_private_key(CURVE))

    @property
    def public_bytes(self) -> bytes:
        return self._public.public_bytes(
            serialization.Encoding.X962,
            serialization.PublicFormat.UncompressedPoint,
        )

    def sign(self, payload: bytes) -> bytes:
        return self._private.sign(payload, ec.ECDSA(HASH))


def public_from_bytes(data: bytes) -> ec.EllipticCurvePublicKey:
    return ec.EllipticCurvePublicKey.from_encoded_point(CURVE, data)


def verify(public: ec.EllipticCurvePublicKey, payload: bytes, signature: bytes) -> bool:
    try:
        public.verify(signature, payload, ec.ECDSA(HASH))
        return True
    except InvalidSignature:
        return False
