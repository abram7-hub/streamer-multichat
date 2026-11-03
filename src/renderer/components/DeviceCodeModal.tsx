interface Props {
  userCode: string
  verificationUri: string
  onClose: () => void
}

export function DeviceCodeModal({ userCode, verificationUri, onClose }: Props) {
  return (
    <div className="modal-backdrop">
      <div className="modal">
        <h3>Logowanie do Twitcha</h3>
        <p className="help-text">
          Otworzyliśmy w przeglądarce stronę {verificationUri}. Jeśli się nie otworzyła, wejdź na nią ręcznie i
          wpisz poniższy kod:
        </p>
        <div style={{ fontSize: 28, fontWeight: 700, letterSpacing: 4, textAlign: 'center', margin: '16px 0' }}>
          {userCode}
        </div>
        <div className="row" style={{ justifyContent: 'center' }}>
          <button className="btn btn-primary" onClick={onClose}>
            Zamknij
          </button>
        </div>
      </div>
    </div>
  )
}
