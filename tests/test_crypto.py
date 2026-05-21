from specter.crypto import Keypair, public_from_bytes, verify


def test_sign_and_verify_roundtrip():
    kp = Keypair.generate()
    pub = public_from_bytes(kp.public_bytes)
    sig = kp.sign(b"hello")
    assert verify(pub, b"hello", sig)


def test_modified_payload_fails_verify():
    kp = Keypair.generate()
    pub = public_from_bytes(kp.public_bytes)
    sig = kp.sign(b"hello")
    assert not verify(pub, b"goodbye", sig)


def test_wrong_key_fails_verify():
    a = Keypair.generate()
    b = Keypair.generate()
    sig = a.sign(b"hello")
    assert not verify(public_from_bytes(b.public_bytes), b"hello", sig)


def test_public_bytes_roundtrip_stable():
    kp = Keypair.generate()
    pub_bytes = kp.public_bytes
    rebuilt = public_from_bytes(pub_bytes)
    sig = kp.sign(b"x")
    assert verify(rebuilt, b"x", sig)
