// 分片计算
let nextUnitOfWork = null
// 当前根节点
let currentRoot = null
// 正在处理的根节点
let wipRoot = null
// 需要删除的节点
let deletions = null
// 正在处理的 fiber
let wipFiber = null
// hook 索引
let hookIndex = null

function createElement(type, props, ...children) {
    return {
        type,
        props: {
            ...props,
            children: children.map(child =>
                typeof child === "object"
                    ? child
                    : createTextElement(child)
            ),
        },
    }
}

function createTextElement(text) {
    return {
        type: "TEXT_ELEMENT",
        props: {
            nodeValue: text,
            children: [],
        },
    }
}

function createDom(fiber) {
    const dom =
        fiber.type == "TEXT_ELEMENT"
            ? document.createTextNode("")
            : document.createElement(fiber.type)

    updateDom(dom, {}, fiber.props)

    return dom
}

const isEvent = key => key.startsWith("on")
const isProperty = key =>
    key !== "children" && !isEvent(key)
const isNew = (prev, next) => key =>
    prev[key] !== next[key]
const isGone = (prev, next) => key => !(key in next)

/* 
真正更新 dom 的地方
1. 处理事件
2. 移除不用的属性
3. 添加/更新属性
*/
function updateDom(dom, prevProps, nextProps) {
    //Remove old or changed event listeners
    Object.keys(prevProps)
        .filter(isEvent)
        .filter(
            key =>
                !(key in nextProps) ||
                isNew(prevProps, nextProps)(key)
        )
        .forEach(name => {
            const eventType = name
                .toLowerCase()
                .substring(2)
            dom.removeEventListener(
                eventType,
                prevProps[name]
            )
        })

    // Remove old properties
    Object.keys(prevProps)
        .filter(isProperty)
        .filter(isGone(prevProps, nextProps))
        .forEach(name => {
            dom[name] = ""
        })

    // Set new or changed properties
    Object.keys(nextProps)
        .filter(isProperty)
        .filter(isNew(prevProps, nextProps))
        .forEach(name => {
            dom[name] = nextProps[name]
        })

    // Add event listeners
    Object.keys(nextProps)
        .filter(isEvent)
        .filter(isNew(prevProps, nextProps))
        .forEach(name => {
            const eventType = name
                .toLowerCase()
                .substring(2)
            dom.addEventListener(
                eventType,
                nextProps[name]
            )
        })
}


function commitRoot() {
    // 先把需要删除的节点清理掉。
    deletions.forEach(commitWork)
    // 从根节点开始，更新子节点。
    commitWork(wipRoot.child)
    //dom 更新完之后
    // 正在处理的根节点，就转变了当前根节点。
    currentRoot = wipRoot
    // 正在处理的根节点变成 null。
    wipRoot = null
}

function commitWork(fiber) {
    if (!fiber) {
        return
    }

    // 循环找到挂载的根节点
    let domParentFiber = fiber.parent
    while (!domParentFiber.dom) {
        domParentFiber = domParentFiber.parent
    }
    // dom 根节点
    const domParent = domParentFiber.dom

    // fiber 协调后，产生 effectTag 
    // 添加新节点
    if (
        fiber.effectTag === "PLACEMENT" &&
        fiber.dom != null
    ) {
        domParent.appendChild(fiber.dom)
    } else if (
        fiber.effectTag === "UPDATE" &&
        fiber.dom != null
    ) {
        // 更新节点
        updateDom(
            fiber.dom,
            fiber.alternate.props,
            fiber.props
        )
    } else if (fiber.effectTag === "DELETION") {
        // 删除节点
        commitDeletion(fiber, domParent)
    }
    // 提交孩子节点的工作
    commitWork(fiber.child)
    // 提交兄弟节点的工作
    commitWork(fiber.sibling)
}

// 提交需要删除节点的工作
function commitDeletion(fiber, domParent) {
    if (fiber.dom) {
        // 存在挂载的 dom 节点，则直接删除 dom 即可。
        domParent.removeChild(fiber.dom)
    } else {
        // 否则，递归子节点删除。
        commitDeletion(fiber.child, domParent)
    }
}

function render(element, container) {

    // 初始化 fiber 
    wipRoot = {
        dom: container,
        props: {
            children: [element],
        },
        alternate: currentRoot,
    }

    // 需要删除的节点
    deletions = []
    // 下一批工作
    nextUnitOfWork = wipRoot
}

// 调度，切片工作。解决渲染卡顿。
function workLoop(deadline) {
    let shouldYield = false
    while (nextUnitOfWork && !shouldYield) {
        // 不需要释放计算资源时，执行分片执行 diff 算法。
        nextUnitOfWork = performUnitOfWork(
            nextUnitOfWork
        )

        // 是否释放计算资源
        // timeRemaining 返回一个时间DOMHighResTimeStamp, 并且是浮点类型的数值，它用来表示当前闲置周期的预估剩余毫秒数。
        // 如果idle period已经结束，则它的值是0。你的回调函数(传给requestIdleCallback的函数)
        // 可以重复的访问这个属性用来判断当前线程的闲置时间是否可以在结束前执行更多的任务。
        shouldYield = deadline.timeRemaining() < 1
    }

    // 没有下一个工作单元，即fiber tree 已经遍历完成，回到了 root 节点。此时开始渲染节点到 dom

    // 在 diff 工作没有完成之前是不会渲染的。这样可以保证每次绘制出来的组件状态保持一致。
    if (!nextUnitOfWork && wipRoot) {
        commitRoot()
    }

    requestIdleCallback(workLoop)
}

// https://developer.mozilla.org/zh-CN/docs/Web/API/Window/requestIdleCallback
// 在浏览器空闲时间内执行，相当于分片计算。
// 因为这个 API 的浏览器兼容性不好，详情参见 MDN。目前 React 没有使用这个函数了，而是自己造了一套调度工具，react-scheduler。
requestIdleCallback(workLoop)


// 将 fiber tree 遍历，组成链表。计算一个节点，然后返回下一个节点。
function performUnitOfWork(fiber) {

    // 1. diff 组件
    const isFunctionComponent =
        fiber.type instanceof Function
    if (isFunctionComponent) {
        // 函数组件 Rect16之后 推崇函数组件，相比于类组件，函数组件搭配 hook 代码量更少&更清晰。
        updateFunctionComponent(fiber)
    } else {
        // 纯组件 ???  这里不是很清楚
        updateHostComponent(fiber)
    }

    // 2. 返回下一个 fiber
    // 优先返回孩子节点
    if (fiber.child) {
        return fiber.child
    }
    let nextFiber = fiber
    while (nextFiber) {
        // 没有孩子节点的情况下，返回兄弟节点
        if (nextFiber.sibling) {
            return nextFiber.sibling
        }
        // 都没有的情况下，返回父节点。
        // 最终会回到 root 节点，即表明 fiber tree 计算完毕，可以渲染了。
        nextFiber = nextFiber.parent
    }
}



function useState(initial) {
    const oldHook =
        wipFiber.alternate &&
        wipFiber.alternate.hooks &&
        wipFiber.alternate.hooks[hookIndex]
    const hook = {
        state: oldHook ? oldHook.state : initial,
        queue: [],
    }

    const actions = oldHook ? oldHook.queue : []
    actions.forEach(action => {
        // 这里传入的 action 是函数，参数为 hool.state
        hook.state = action(hook.state)
    })

    const setState = action => {
        hook.queue.push(action)
        wipRoot = {
            dom: currentRoot.dom,
            props: currentRoot.props,
            alternate: currentRoot,
        }
        // state 变更之后，将 nextUnitOfWork 设置为当前节点，则更新工作无需考虑当前节点的父节点。
        nextUnitOfWork = wipRoot
        deletions = []
    }

    wipFiber.hooks.push(hook)
    hookIndex++
    return [hook.state, setState]
}

function updateFunctionComponent(fiber) {
    wipFiber = fiber
    hookIndex = 0
    wipFiber.hooks = []
    // 函数组件的 children 是函数返回的。
    const children = [fiber.type(fiber.props)]
    // 协调
    reconcileChildren(fiber, children)
}


function updateHostComponent(fiber) {
    if (!fiber.dom) {
        fiber.dom = createDom(fiber)
    }
    reconcileChildren(fiber, fiber.props.children)
}


// 协作，新旧 tree 比较。该更新的更新，该删除的删除，该添加的添加。
// 参见 https://zh-hans.reactjs.org/docs/reconciliation.html
function reconcileChildren(wipFiber, elements) {
    let index = 0
    let oldFiber =
        wipFiber.alternate && wipFiber.alternate.child

    // 第一次执行函数时，odlFiber 值为 bool，while 循环后，oldFiber 才是 Fiber 结构。
    let prevSibling = null

    while (
        index < elements.length ||
        oldFiber != null
    ) {
        const element = elements[index]
        let newFiber = null

        const sameType =
            oldFiber &&
            element &&
            element.type == oldFiber.type

        // 节点类型相同，更新属性即可。
        if (sameType) {
            newFiber = {
                type: oldFiber.type,
                props: element.props,
                dom: oldFiber.dom,
                parent: wipFiber,
                alternate: oldFiber,
                effectTag: "UPDATE",
            }
        }
        // 节点类型不同，直接添加节点。
        if (element && !sameType) {
            newFiber = {
                type: element.type,
                props: element.props,
                dom: null,
                parent: wipFiber,
                alternate: null,
                effectTag: "PLACEMENT",
            }
        }
        // 存在旧节点，但是节点类型不同，则直接删除旧节点。
        if (oldFiber && !sameType) {
            oldFiber.effectTag = "DELETION"
            deletions.push(oldFiber)
        }

        if (oldFiber) {
            oldFiber = oldFiber.sibling
        }

        // 第一个子节点为孩子节点。
        if (index === 0) {
            wipFiber.child = newFiber
        } else if (element) {
            prevSibling.sibling = newFiber
        }

        prevSibling = newFiber
        index++
    }
}

const Alice = {
    createElement,
    render,
    useState,
}

export default Alice