import Alice from './alice'

const container = document.getElementById("root")

function Counter() {
    const [state, setState] = Alice.useState(2)
    return (
        <h1 onClick={() => setState(c => c + 1)}>
            Count: {state}
        </h1>
    )
}


Alice.render(<Counter />, container)